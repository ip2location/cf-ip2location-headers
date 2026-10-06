import { HEADER_PREFIX, readConfig } from './config';
import type { Config } from './config';
import { DEFAULT_FIELDS } from './fields';
import { buildHeaders, headerSafe } from './headers';
import { lookupIp } from './lookup';
import type { LookupDeps } from './lookup';
import type { CacheLike, Env, ExecutionContextLike, LookupResult } from './types';

const DEBUG_PATH = '/__ip2location';

export interface WorkerDeps {
	fetch?: typeof fetch;
	cache?: CacheLike | null;
}

export function createWorker(deps: WorkerDeps = {}) {
	const doFetch = deps.fetch ?? fetch;

	return {
		async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
			const url = new URL(request.url);
			const config = readConfig(env);
			const lookupDeps: LookupDeps = {
				fetch: doFetch,
				apiKey: env.IP2LOCATION_API_KEY,
				cache: deps.cache === undefined ? edgeCache() : (deps.cache ?? undefined),
				waitUntil: (promise) => ctx.waitUntil(promise),
			};

			try {
				if (url.pathname === DEBUG_PATH) return await handleDebug(request, url, config, lookupDeps);
				const result = await lookupIp(clientIp(request, config), config, lookupDeps);
				return await forward(request, result, doFetch);
			} catch (e) {
				ctx.passThroughOnException?.();
				console.error('ip2location enrichment failed', (e as Error).message);
				return await forward(request, { data: null, status: 'error', ip: '', network: '', error: 'worker error' }, doFetch);
			}
		},
	};
}

export default createWorker();

function clientIp(request: Request, config: Config): string {
	const direct = request.headers.get('cf-connecting-ip');
	if (direct !== null && direct.trim() !== '') return direct.trim();
	if (config.trustXff) {
		const xff = request.headers.get('x-forwarded-for');
		if (xff !== null) return (xff.split(',')[0] ?? '').trim();
	}
	return '';
}

function stripPrefix(inbound: Headers): Headers {
	const prefix = HEADER_PREFIX.toLowerCase();
	const headers = new Headers();
	inbound.forEach((value, name) => {
		if (name.toLowerCase().startsWith(prefix)) return;
		headers.set(name, value);
	});
	return headers;
}

function applyEnrichment(headers: Headers, result: LookupResult): void {
	headers.set(`${HEADER_PREFIX}Lookup`, result.status);
	if (result.error !== undefined) headers.set(`${HEADER_PREFIX}Error`, headerSafe(result.error));
	if (!result.data) return;

	for (const [name, value] of Object.entries(buildHeaders(result.data, HEADER_PREFIX, DEFAULT_FIELDS))) {
		headers.set(name, value);
	}
}

async function forward(request: Request, result: LookupResult, doFetch: typeof fetch): Promise<Response> {
	const headers = stripPrefix(request.headers);
	applyEnrichment(headers, result);

	const init: RequestInit = { method: request.method, headers, redirect: 'manual' };
	if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;

	return doFetch(new Request(request.url, init));
}

async function handleDebug(request: Request, url: URL, config: Config, deps: LookupDeps): Promise<Response> {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'access-control-allow-origin': config.allowedOrigins,
		'access-control-allow-headers': 'content-type',
	};
	if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

	const override = config.allowQueryIp ? (url.searchParams.get('ip') ?? '').trim() : '';
	const result = await lookupIp(override !== '' ? override : clientIp(request, config), config, deps);
	const emitted = result.data ? buildHeaders(result.data, HEADER_PREFIX, DEFAULT_FIELDS) : {};

	return json({ ip: result.ip, lookup: result.status, network: result.network, error: result.error ?? null, headers: emitted, data: result.data }, 200, headers);
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
	return new Response(JSON.stringify(body), { status, headers });
}

function edgeCache(): CacheLike | undefined {
	const caches = (globalThis as { caches?: { default?: CacheLike } }).caches;
	return caches?.default;
}
