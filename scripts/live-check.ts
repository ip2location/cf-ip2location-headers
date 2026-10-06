import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HEADER_PREFIX, readConfig } from '../src/config';
import { DEFAULT_FIELDS } from '../src/fields';
import { buildHeaders } from '../src/headers';
import { lookupIp } from '../src/lookup';
import type { CacheLike, Env, IpData } from '../src/types';

const DEFAULTS = ['175.144.151.253', '8.8.8.8', '102.129.143.3', '2001:4860:4860::8888'];

function devVars(): Record<string, string> {
	const path = join(import.meta.dir, '..', '.dev.vars');
	if (!existsSync(path)) return {};
	const out: Record<string, string> = {};
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const trimmed = line.trim();
		if (trimmed === '' || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
	}
	return out;
}

class CountingCache implements CacheLike {
	readonly entries = new Map<string, string>();
	reads = 0;
	writes = 0;

	async match(request: Request): Promise<Response | undefined> {
		const body = this.entries.get(request.url);
		if (body === undefined) return undefined;
		this.reads++;
		return new Response(body, { headers: { 'content-type': 'application/json' } });
	}

	async put(request: Request, response: Response): Promise<void> {
		this.writes++;
		this.entries.set(request.url, await response.text());
	}
}

const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const list = targets.length > 0 ? [...targets, targets[0]!] : [...DEFAULTS, DEFAULTS[0]!];

const vars = devVars();
const env: Env = { ...vars, CACHE_TTL: '3600' };
const config = readConfig(env);

if (!env.IP2LOCATION_API_KEY) {
	console.log('No IP2LOCATION_API_KEY in .dev.vars; falling back to the keyless lane.\n');
}

const cache = new CountingCache();
let calls = 0;
const countingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	calls++;
	return fetch(input, init);
}) as unknown as typeof fetch;

console.log(`fields: ${DEFAULT_FIELDS.length} (${DEFAULT_FIELDS.join(', ')})`);
console.log('');

for (const ip of list) {
	const result = await lookupIp(ip, config, {
		fetch: countingFetch,
		apiKey: env.IP2LOCATION_API_KEY,
		cache,
		waitUntil: (p) => void p,
	});

	console.log(`${ip}  ->  ${result.status}  [${result.network || '-'}]`);
	if (result.error) console.log(`    error: ${result.error}`);
	if (result.data) {
		for (const [name, value] of Object.entries(buildHeaders(result.data, HEADER_PREFIX, DEFAULT_FIELDS))) {
			console.log(`    ${name}: ${value}`);
		}
		const proxy = result.data['proxy'] as Record<string, unknown> | undefined;
		if (proxy) console.log(`    (fraud_score=${result.data['fraud_score']}, is_proxy=${result.data['is_proxy']})`);
		void (result.data as IpData);
	}
	console.log('');
}

console.log(`API calls: ${calls}, cache writes: ${cache.writes}, cache hits: ${cache.reads}`);
console.log('The last address repeats the first, so it should report "hit".');
