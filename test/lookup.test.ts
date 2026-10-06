import { describe, expect, test } from 'bun:test';
import { lookupIp } from '../src/lookup';
import type { LookupOptions } from '../src/lookup';
import { DATACENTER_PAYLOAD, MemoryCache, MY_PAYLOAD, collector, jsonResponse, recordingFetch } from './helpers';

const OPTS: LookupOptions = { ttl: 3600 };

function deps(reply: Parameters<typeof recordingFetch>[0], options: Partial<LookupOptions> = {}, cache = new MemoryCache()) {
	const fetcher = recordingFetch(reply);
	const c = collector();
	return {
		fetcher,
		cache,
		collector: c,
		run: (ip: string, opts: Partial<LookupOptions> = {}) => lookupIp(ip, { ...OPTS, ...options, ...opts }, { fetch: fetcher.fetch, apiKey: 'TESTKEY', cache, waitUntil: c.waitUntil }),
	};
}

describe('lookupIp', () => {
	test('queries the API with the address and key', async () => {
		const d = deps(() => jsonResponse(MY_PAYLOAD));
		const result = await d.run('175.144.151.253');

		expect(result.status).toBe('miss');
		expect(result.data?.isp).toBe('Telekom Malaysia Berhad');
		const url = new URL(d.fetcher.calls[0]!);
		expect(url.origin + url.pathname).toBe('https://api.ip2location.io/');
		expect(url.searchParams.get('ip')).toBe('175.144.151.253');
		expect(url.searchParams.get('key')).toBe('TESTKEY');
		expect(url.searchParams.get('format')).toBe('json');
	});

	test('serves the second identical lookup from cache', async () => {
		const d = deps(() => jsonResponse(MY_PAYLOAD));
		await d.run('175.144.151.253');
		await d.collector.settle();
		const second = await d.run('175.144.151.253');

		expect(second.status).toBe('hit');
		expect(d.fetcher.calls.length).toBe(1);
		expect(d.cache.hits.length).toBe(1);
	});

	test('serves another address in the same /24 from cache', async () => {
		const d = deps(() => jsonResponse(MY_PAYLOAD));
		await d.run('175.144.151.253');
		await d.collector.settle();
		const second = await d.run('175.144.151.9');

		expect(second.status).toBe('hit');
		expect(d.fetcher.calls.length).toBe(1);
	});

	test('does not share a cache entry across /24 boundaries', async () => {
		const d = deps(() => jsonResponse(MY_PAYLOAD));
		await d.run('175.144.151.1');
		await d.collector.settle();
		await d.run('175.144.152.1');
		expect(d.fetcher.calls.length).toBe(2);
	});

	test('caches the lookup under the network, not the address', async () => {
		const d = deps(() => jsonResponse(MY_PAYLOAD));
		await d.run('175.144.151.253');
		await d.collector.settle();
		expect([...d.cache.entries.keys()]).toEqual(['https://ip2location.cache/175.144.151.0']);
	});

	test('never caches the per-request ip field or the lookup timestamp', async () => {
		const d = deps(() => jsonResponse(MY_PAYLOAD));
		await d.run('175.144.151.253');
		await d.collector.settle();

		const cached = JSON.parse([...d.cache.entries.values()][0]!.body);
		expect(cached.ip).toBeUndefined();
		expect(cached.time_zone_info.current_time).toBeUndefined();

		expect(cached.time_zone_info.abbreviation).toBe('MYT');
		expect(cached.country_code).toBe('MY');
	});

	test('stores the configured TTL', async () => {
		const d = deps(() => jsonResponse(MY_PAYLOAD), { ttl: 120 });
		await d.run('175.144.151.253');
		await d.collector.settle();
		expect([...d.cache.entries.values()][0]!.maxAge).toBe(120);
	});

	test('reports a 200 carrying an error object as a failure', async () => {
		const d = deps(() => jsonResponse({ error: { error_code: 10001, error_message: 'Invalid IP address.' } }));
		const result = await d.run('175.144.151.253');

		expect(result.status).toBe('error');
		expect(result.data).toBeNull();
		expect(result.error).toBe('10001: Invalid IP address.');
	});

	test('falls back to the keyless lane when the quota is exhausted', async () => {
		const d = deps((url) => (url.includes('key=') ? jsonResponse({ error: { error_code: 10000, error_message: 'Invalid API key or insufficient query.' } }) : jsonResponse(MY_PAYLOAD)));
		const result = await d.run('175.144.151.253');

		expect(result.data?.isp).toBe('Telekom Malaysia Berhad');
		expect(d.fetcher.calls.length).toBe(2);
		expect(new URL(d.fetcher.calls[1]!).searchParams.get('key')).toBeNull();
	});

	test('does not retry keyless when no key was configured', async () => {
		const fetcher = recordingFetch(() => jsonResponse({ error: { error_code: 10000, error_message: 'quota' } }));
		const c = collector();
		const result = await lookupIp('175.144.151.253', OPTS, { fetch: fetcher.fetch, apiKey: '', cache: new MemoryCache(), waitUntil: c.waitUntil });

		expect(result.status).toBe('error');
		expect(fetcher.calls.length).toBe(1);
	});

	test('does not retry keyless on an unrelated error code', async () => {
		const fetcher = recordingFetch(() => jsonResponse({ error: { error_code: 10002, error_message: 'Internal server error.' } }));
		const c = collector();
		await lookupIp('175.144.151.253', OPTS, { fetch: fetcher.fetch, apiKey: 'TESTKEY', cache: new MemoryCache(), waitUntil: c.waitUntil });
		expect(fetcher.calls.length).toBe(1);
	});

	test('treats an HTTP failure as an error, not as data', async () => {
		const d = deps(() => new Response('nope', { status: 500 }));
		expect((await d.run('175.144.151.253')).status).toBe('error');
	});

	test('survives a network exception', async () => {
		const fetcher = (async () => {
			throw new Error('connection reset');
		}) as unknown as typeof fetch;
		const c = collector();
		const result = await lookupIp('175.144.151.253', OPTS, { fetch: fetcher, apiKey: 'K', cache: new MemoryCache(), waitUntil: c.waitUntil });

		expect(result.status).toBe('error');
		expect(result.error).toContain('connection reset');
	});

	test('rejects an invalid address without spending a query', async () => {
		const d = deps(() => jsonResponse(MY_PAYLOAD));
		const result = await d.run('not-an-ip');

		expect(result.status).toBe('invalid');
		expect(d.fetcher.calls.length).toBe(0);
	});

	test('guards against a payload that is not a lookup result', async () => {
		const d = deps(() => jsonResponse({ hello: 'world' }));
		expect((await d.run('175.144.151.253')).status).toBe('error');
	});

	test('skips caching entirely when the TTL is 0', async () => {
		const d = deps(() => jsonResponse(MY_PAYLOAD), { ttl: 0 });
		const first = await d.run('175.144.151.253');
		await d.collector.settle();
		const second = await d.run('175.144.151.253');

		expect(first.status).toBe('off');
		expect(second.status).toBe('off');
		expect(d.cache.entries.size).toBe(0);
		expect(d.fetcher.calls.length).toBe(2);
	});

	test('keeps security fields intact through the cache', async () => {
		const d = deps(() => jsonResponse(DATACENTER_PAYLOAD));
		await d.run('8.8.8.8');
		await d.collector.settle();
		const result = await d.run('8.8.8.4');

		expect(result.status).toBe('hit');
		expect((result.data?.proxy as Record<string, unknown>).is_ai_crawler).toBe(true);
		expect(result.data?.fraud_score).toBe(42);
	});
});
