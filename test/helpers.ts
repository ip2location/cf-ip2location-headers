import type { CacheLike, Env } from '../src/types';

export const MY_PAYLOAD = {
	ip: '175.144.151.253',
	country_code: 'MY',
	country_name: 'Malaysia',
	region_name: 'Pulau Pinang',
	district: 'Daerah Timur Laut',
	city_name: 'George Town',
	latitude: 5.41146,
	longitude: 100.33543,
	zip_code: '10300',
	time_zone: '+08:00',
	asn: '4788',
	as: 'TM Technology Services Sdn. Bhd.',
	as_info: {
		as_number: '4788',
		as_name: 'TM Technology Services Sdn. Bhd.',
		as_domain: 'unifi.com.my',
		as_usage_type: 'ISP/MOB',
		as_cidr: '175.144.128.0/18',
	},
	isp: 'Telekom Malaysia Berhad',
	domain: 'tm.net.my',
	net_speed: 'DSL',
	idd_code: '60',
	area_code: '04',
	weather_station_code: 'MYXX0002',
	weather_station_name: 'George Town',
	mcc: '-',
	mnc: '-',
	mobile_brand: '-',
	elevation: 2,
	usage_type: 'ISP',
	address_type: 'Unicast',
	ads_category: '419',
	ads_category_name: 'Internet Service Providers',
	country: {
		name: 'Malaysia',
		alpha3_code: 'MYS',
		numeric_code: 458,
		demonym: 'Malaysians',
		capital: 'Kuala Lumpur',
		currency: { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
		language: { code: 'MS', name: 'Malay' },
		tld: 'my',
	},
	time_zone_info: {
		olson: 'Asia/Kuala_Lumpur',
		current_time: '2026-10-06T10:55:27+08:00',
		gmt_offset: 28800,
		is_dst: false,
		abbreviation: 'MYT',
		sunrise: '07:06',
		sunset: '19:09',
	},
	is_proxy: false,
	fraud_score: 0,
	proxy: {
		last_seen: 0,
		proxy_type: '-',
		threat: '-',
		provider: '-',
		is_vpn: false,
		is_tor: false,
		is_data_center: false,
		is_public_proxy: false,
		is_web_proxy: false,
		is_web_crawler: false,
		is_ai_crawler: false,
		is_residential_proxy: false,
		is_consumer_privacy_network: false,
		is_enterprise_private_network: false,
		is_spammer: false,
		is_scanner: false,
		is_botnet: false,
		is_bogon: false,
	},
};

export const DATACENTER_PAYLOAD = {
	...MY_PAYLOAD,
	is_proxy: true,
	fraud_score: 42,
	proxy: {
		...MY_PAYLOAD.proxy,
		last_seen: 3,
		proxy_type: 'DCH',
		provider: 'Example Hosting',
		is_data_center: true,
		is_ai_crawler: true,
	},
};

export function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

export function recordingFetch(reply: (url: string, call: number) => Response) {
	const calls: string[] = [];
	const stub = (async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		calls.push(url);
		return reply(url, calls.length - 1);
	}) as unknown as typeof fetch;
	return { fetch: stub, calls };
}

export const API_ORIGIN = 'https://api.ip2location.io/';

export class MemoryCache implements CacheLike {
	readonly entries = new Map<string, { body: string; maxAge: number }>();
	readonly hits: string[] = [];

	async match(request: Request): Promise<Response | undefined> {
		const entry = this.entries.get(request.url);
		if (!entry) return undefined;
		this.hits.push(request.url);
		return new Response(entry.body, { headers: { 'content-type': 'application/json' } });
	}

	async put(request: Request, response: Response): Promise<void> {
		const body = await response.text();
		const cacheControl = response.headers.get('cache-control') ?? '';
		this.entries.set(request.url, { body, maxAge: Number(/max-age=(\d+)/.exec(cacheControl)?.[1] ?? 0) });
	}
}

export function collector() {
	const pending: Promise<unknown>[] = [];
	return {
		pending,
		waitUntil: (promise: Promise<unknown>) => {
			pending.push(promise);
		},
		async settle() {
			await Promise.all(pending);
		},
	};
}

export function makeEnv(overrides: Env = {}): Env {
	return { IP2LOCATION_API_KEY: 'TESTKEY', CACHE_TTL: '3600', ...overrides };
}
