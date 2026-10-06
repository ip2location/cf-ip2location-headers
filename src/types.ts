export interface Env {
	IP2LOCATION_API_KEY?: string;
	CACHE_TTL?: string;
	ALLOW_QUERY_IP?: string;
	TRUST_XFF?: string;
	ALLOWED_ORIGINS?: string;
}

export interface ExecutionContextLike {
	waitUntil(promise: Promise<unknown>): void;
	passThroughOnException?(): void;
}

export interface CacheLike {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

export interface CacheStatus {
	status: 'hit' | 'miss' | 'error' | 'invalid' | 'off';
	error?: string;
}

export type IpData = Record<string, unknown>;

export interface LookupResult extends CacheStatus {
	data: IpData | null;
	ip: string;
	network: string;
}
