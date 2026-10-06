import { describe, expect, test } from 'bun:test';
import { createWorker } from '../src/index';
import type { CacheLike } from '../src/types';
import { API_ORIGIN, MY_PAYLOAD, MemoryCache, collector, jsonResponse, makeEnv } from './helpers';

const P = 'X-IP2Location-';

interface Setup {
	api?: () => Response;
	origin?: () => Response;
	env?: ReturnType<typeof makeEnv>;
	cache?: CacheLike;
}

function setup({ api, origin, env = makeEnv(), cache = new MemoryCache() }: Setup = {}) {
	const apiReply = api ?? (() => jsonResponse(MY_PAYLOAD));
	const originReply = origin ?? (() => new Response('origin body'));
	const requests: Request[] = [];
	const lookups: string[] = [];

	const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(input.toString(), init);
		if (request.url.startsWith(API_ORIGIN)) {
			lookups.push(request.url);
			return apiReply();
		}
		requests.push(request);
		return originReply();
	}) as unknown as typeof fetch;

	const c = collector();
	const worker = createWorker({ fetch: stub, cache });
	return {
		requests,
		lookups,
		settle: c.settle,
		cache,
		call: (url: string, init: RequestInit = {}, overrides = {}) => worker.fetch(new Request(url, init), { ...env, ...overrides }, { waitUntil: c.waitUntil }),
	};
}

const VISITOR = { 'cf-connecting-ip': '175.144.151.253' };

describe('enrichment', () => {
	test('forwards the request with the enrichment headers attached', async () => {
		const s = setup();
		await s.call('https://shop.example.com/cart', { headers: VISITOR });

		const sent = s.requests[0]!;
		expect(sent.url).toBe('https://shop.example.com/cart');
		expect(sent.headers.get(P + 'ISP')).toBe('Telekom Malaysia Berhad');
		expect(sent.headers.get(P + 'Usage-Type')).toBe('ISP');
		expect(sent.headers.get(P + 'Country-Currency')).toBe('MYR');
		expect(sent.headers.get(P + 'Lookup')).toBe('miss');
		expect(sent.headers.get(P + 'Network')).toBeNull();
	});

	test('queries the API for the visitor address only', async () => {
		const s = setup();
		await s.call('https://shop.example.com/', { headers: VISITOR });

		expect(s.lookups.length).toBe(1);
		expect(new URL(s.lookups[0]!).searchParams.get('ip')).toBe('175.144.151.253');
	});

	test('does not emit fields Cloudflare already provides', async () => {
		const s = setup();
		await s.call('https://shop.example.com/', { headers: VISITOR });

		for (const name of ['Country', 'Region', 'City', 'Latitude', 'Longitude', 'Postal-Code', 'Timezone', 'ASN']) {
			expect(s.requests[0]!.headers.get(P + name)).toBeNull();
		}
	});

	test('preserves the method, body and unrelated headers', async () => {
		const s = setup();
		await s.call('https://shop.example.com/checkout', {
			method: 'POST',
			body: 'a=1',
			headers: { ...VISITOR, 'content-type': 'application/x-www-form-urlencoded', 'x-custom': 'keep' },
		});

		const sent = s.requests[0]!;
		expect(sent.method).toBe('POST');
		expect(await sent.text()).toBe('a=1');
		expect(sent.headers.get('x-custom')).toBe('keep');
		expect(sent.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
	});

	test('returns the origin response untouched', async () => {
		const s = setup({ origin: () => new Response('hello', { status: 201, headers: { 'x-origin': 'yes' } }) });
		const res = await s.call('https://shop.example.com/', { headers: VISITOR });

		expect(res.status).toBe(201);
		expect(await res.text()).toBe('hello');
		expect(res.headers.get('x-origin')).toBe('yes');
	});
});

describe('anti-forgery', () => {
	test('drops visitor-supplied headers carrying our prefix', async () => {
		const s = setup();
		await s.call('https://shop.example.com/', {
			headers: {
				...VISITOR,
				'x-ip2location-isp': 'Evil Corp',
				'X-IP2Location-Is-VPN': 'false',
				'X-IP2Location-Fraud-Score': '99',
				'X-IP2Location-Anything-Else': '1',
			},
		});

		const sent = s.requests[0]!;

		expect(sent.headers.get(P + 'ISP')).toBe('Telekom Malaysia Berhad');

		expect(sent.headers.get(P + 'Is-VPN')).toBeNull();

		expect(sent.headers.get(P + 'Fraud-Score')).toBe('0');
		expect(sent.headers.get(P + 'Anything-Else')).toBeNull();
	});

	test('strips forged headers even when the lookup fails', async () => {
		const s = setup({ api: () => new Response('down', { status: 503 }) });
		await s.call('https://shop.example.com/', {
			headers: { ...VISITOR, 'x-ip2location-isp': 'Evil Corp' },
		});

		const sent = s.requests[0]!;
		expect(sent.headers.get(P + 'ISP')).toBeNull();
		expect(sent.headers.get(P + 'Lookup')).toBe('error');
		expect(sent.headers.get(P + 'Error')).toContain('503');
	});

	test('does not forward anything for the debug path', async () => {
		const s = setup({ env: makeEnv({ ALLOW_QUERY_IP: '1' }) });
		await s.call('https://shop.example.com/__ip2location?ip=175.144.151.253', {
			headers: { 'x-ip2location-fraud-score': '0' },
		});
		expect(s.requests.length).toBe(0);
	});
});

describe('failure handling', () => {
	test('still forwards with no enrichment headers when the lookup errors', async () => {
		const s = setup({ api: () => jsonResponse({ error: { error_code: 10002, error_message: 'Internal server error.' } }) });
		const res = await s.call('https://shop.example.com/', { headers: VISITOR });

		expect(s.requests.length).toBe(1);
		expect(s.requests[0]!.headers.get(P + 'ISP')).toBeNull();
		expect(s.requests[0]!.headers.get(P + 'Lookup')).toBe('error');
		expect(s.requests[0]!.headers.get(P + 'Error')).toBe('10002: Internal server error.');
		expect(res.status).toBe(200);
	});

	test('forwards an unenriched request when no client address is available', async () => {
		const s = setup();
		await s.call('https://shop.example.com/');

		expect(s.requests[0]!.headers.get(P + 'Lookup')).toBe('invalid');
		expect(s.lookups.length).toBe(0);
	});

	test('ignores X-Forwarded-For unless explicitly trusted', async () => {
		const s = setup();
		await s.call('https://shop.example.com/', { headers: { 'x-forwarded-for': '175.144.151.253' } });
		expect(s.requests[0]!.headers.get(P + 'Lookup')).toBe('invalid');

		const trusted = setup({ env: makeEnv({ TRUST_XFF: '1' }) });
		await trusted.call('https://shop.example.com/', { headers: { 'x-forwarded-for': '175.144.151.253, 10.0.0.1' } });
		expect(trusted.requests[0]!.headers.get(P + 'ISP')).toBe('Telekom Malaysia Berhad');
	});

	test('prefers CF-Connecting-IP over X-Forwarded-For', async () => {
		const s = setup({ env: makeEnv({ TRUST_XFF: '1' }) });
		await s.call('https://shop.example.com/', {
			headers: { 'cf-connecting-ip': '175.144.151.253', 'x-forwarded-for': '1.1.1.1' },
		});

		expect(new URL(s.lookups[0]!).searchParams.get('ip')).toBe('175.144.151.253');
	});

	test('fails open when the cache itself throws', async () => {
		const brokenCache: CacheLike = {
			match: async () => {
				throw new Error('cache unavailable');
			},
			put: async () => undefined,
		};
		const s = setup({ cache: brokenCache });
		const res = await s.call('https://shop.example.com/', { headers: VISITOR });

		expect(res.status).toBe(200);
		expect(s.requests.length).toBe(1);
		expect(s.requests[0]!.headers.get(P + 'Lookup')).toBe('error');
	});
});

describe('origin rewriting', () => {
	test('does not follow origin redirects itself', async () => {
		const s = setup({ origin: () => new Response(null, { status: 302, headers: { location: '/elsewhere' } }) });
		const res = await s.call('https://shop.example.com/', { headers: VISITOR });

		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('/elsewhere');
	});
});

describe('debug endpoint', () => {
	test('reports the headers that would be sent, plus the payload', async () => {
		const s = setup({ env: makeEnv({ ALLOW_QUERY_IP: '1' }) });
		const res = await s.call('https://shop.example.com/__ip2location?ip=175.144.151.253');
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.ip).toBe('175.144.151.253');
		expect(body.lookup).toBe('miss');
		expect(body.network).toBe('175.144.151.0');
		expect(body.headers['X-IP2Location-ISP']).toBe('Telekom Malaysia Berhad');
		expect(body.data.country_code).toBe('MY');
	});

	test('ignores ?ip= unless overrides are allowed', async () => {
		const s = setup();
		const res = await s.call('https://shop.example.com/__ip2location?ip=8.8.8.8', { headers: VISITOR });
		expect((await res.json()).ip).toBe('175.144.151.253');
	});

	test('answers CORS preflight', async () => {
		const s = setup();
		const res = await s.call('https://shop.example.com/__ip2location', { method: 'OPTIONS' });
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
	});
});

describe('caching', () => {
	test('a second request for the same network is served from cache', async () => {
		const s = setup();
		await s.call('https://shop.example.com/', { headers: VISITOR });
		await s.settle();
		await s.call('https://shop.example.com/cart', { headers: { 'cf-connecting-ip': '175.144.151.200' } });

		expect(s.requests[0]!.headers.get(P + 'Lookup')).toBe('miss');
		expect(s.requests[1]!.headers.get(P + 'Lookup')).toBe('hit');
		expect(s.lookups.length).toBe(1);
		expect(s.cache.entries.size).toBe(1);
	});
});
