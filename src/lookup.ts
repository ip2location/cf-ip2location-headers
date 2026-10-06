import { networkKey, parseIp } from './ip';
import type { CacheLike, IpData, LookupResult } from './types';

const ENDPOINT = 'https://api.ip2location.io/';

const CACHE_ORIGIN = 'https://ip2location.cache/';

const CACHE_PREFIX_V4 = 24;
const CACHE_PREFIX_V6 = 48;

export interface LookupOptions {
	ttl: number;
}

export interface LookupDeps {
	fetch: typeof fetch;
	apiKey?: string;
	cache?: CacheLike;
	waitUntil?(promise: Promise<unknown>): void;
}

export async function lookupIp(ip: string, options: LookupOptions, deps: LookupDeps): Promise<LookupResult> {
	const bytes = parseIp(ip);
	if (!bytes) {
		return { data: null, status: 'invalid', ip, network: '', error: 'not a valid IP address' };
	}

	const network = networkKey(bytes, CACHE_PREFIX_V4, CACHE_PREFIX_V6);

	const cacheKey = new Request(CACHE_ORIGIN + network);
	const cache = options.ttl > 0 ? deps.cache : undefined;

	if (cache) {
		const hit = await cache.match(cacheKey);
		if (hit) {
			const data = (await hit.json().catch(() => null)) as IpData | null;
			if (data) return { data, status: 'hit', ip, network };
		}
	}

	const attempt = await query(ip, deps, (deps.apiKey ?? '').trim());
	if (!attempt.data) {
		return { data: null, status: 'error', ip, network, error: attempt.error };
	}

	if (cache && deps.waitUntil) {
		const put = cache.put(cacheKey, jsonResponse(attempt.data, options.ttl));
		deps.waitUntil(put.catch(() => undefined));
	}

	return { data: attempt.data, status: cache ? 'miss' : 'off', ip, network };
}

interface Attempt {
	data: IpData | null;
	error?: string;
	code?: number;
}

async function query(ip: string, deps: LookupDeps, apiKey: string): Promise<Attempt> {
	const first = await request(ip, apiKey, deps.fetch);

	// 10000 covers a bad key and an exhausted quota; the keyless lane still answers.
	if (first.code === 10000 && apiKey !== '') return request(ip, '', deps.fetch);
	return first;
}

async function request(ip: string, key: string, doFetch: typeof fetch): Promise<Attempt> {
	const url = new URL(ENDPOINT);
	url.searchParams.set('ip', ip);
	url.searchParams.set('format', 'json');
	if (key !== '') url.searchParams.set('key', key);

	let res: Response;
	try {
		res = await doFetch(url.toString(), { headers: { accept: 'application/json' } });
	} catch (e) {
		return { data: null, error: `request failed: ${(e as Error).message}` };
	}

	const body = (await res.json().catch(() => null)) as IpData | null;

	// ip2location.io reports failures as HTTP 200 carrying an `error` object,
	// so res.ok alone is not enough.
	const err = body?.['error'] as { error_code?: number; error_message?: string } | undefined;
	if (err) {
		return { data: null, error: `${err.error_code ?? '?'}: ${err.error_message ?? 'unknown error'}`, code: err.error_code };
	}
	if (!res.ok) return { data: null, error: `HTTP ${res.status}` };
	if (!body || typeof body['country_code'] !== 'string') return { data: null, error: 'unexpected response shape' };

	// Per-request values must not be cached under a shared network key.
	delete body['ip'];
	const tz = body['time_zone_info'];
	if (tz !== null && typeof tz === 'object') {
		delete (tz as Record<string, unknown>)['current_time'];
	}

	return { data: body };
}

function jsonResponse(data: IpData, ttl: number): Response {
	return new Response(JSON.stringify(data), {
		headers: {
			'content-type': 'application/json',
			'cache-control': `max-age=${ttl}`,
		},
	});
}
