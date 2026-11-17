# IP2Location.io Headers for Cloudflare Workers

Enrich requests to your origin application with additional IP geolocation, network, and proxy intelligence from [IP2Location.io](https://www.ip2location.io/) using a Cloudflare Worker.

Cloudflare already exposes common location and network information through `request.cf`. This Worker focuses on supplementary IP2Location.io fields, forwarding them as `X-IP2Location-*` request headers so your origin can use them without integrating the IP2Location.io API directly.

## Features

- **Edge-based enrichment:** Add IP intelligence headers before forwarding requests to the origin.
- **Complementary data:** Avoid duplicating the location and ASN fields already offered by Cloudflare.
- **Plan-aware output:** Include fields only when the API response supplies usable values.
- **Caching:** Cache lookups by IPv4 `/24` or IPv6 `/48` network to reduce API requests.
- **Proxy signals:** Forward proxy type, provider, threat classification, risk score, and a combined proxy-flags header where available.
- **Diagnostics:** Inspect lookup status using `X-IP2Location-Lookup` or the `/__ip2location` endpoint.
- **Origin integration:** Read the enriched request headers from PHP, Node.js, Python, or another server-side framework.

## How it works

```text
Visitor
   |
   v
Cloudflare Worker
   |-- Read visitor IP (CF-Connecting-IP)
   |-- Check network-based lookup cache
   |-- Query IP2Location.io on a cache miss
   |-- Remove inbound X-IP2Location-* headers
   |-- Add trusted enrichment and diagnostic headers
   v
Origin application
```

The Worker uses the `CF-Connecting-IP` request header to determine the visitor address. `X-Forwarded-For` can be used as a fallback only when explicitly enabled for local development.

## Requirements

- A Cloudflare account with access to Workers and a route or domain for your application.
- Node.js and npm for installing project tooling.
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (included as a development dependency).
- An [IP2Location.io API key](https://www.ip2location.io/) for authenticated lookup access and additional plan-specific fields. Keyless access is also supported, subject to its limits.
- [Bun](https://bun.sh/) if you want to run the repository's tests and live-check script.

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/ip2location/cf-ip2location-headers.git
cd cf-ip2location-headers
npm install
```

### 2. Configure the API key

Authenticate with Cloudflare if you have not already:

```bash
npx wrangler login
```

Store the API key securely as a Worker secret:

```bash
npx wrangler secret put IP2LOCATION_API_KEY
```

Do not place an API key in `wrangler.toml` or commit it to the repository.

### 3. Deploy

```bash
npx wrangler deploy
```

Configure a route for the Worker in your Cloudflare dashboard (for example, `shop.example.com/*`) so the Worker runs in front of your origin application. Check the Worker routing settings for your particular zone before enabling production traffic.

### 4. Read the headers at your origin

For example, an Express application can retrieve the ISP and lookup status:

```javascript
app.get('/', (req, res) => {
  res.json({
    isp: req.get('x-ip2location-isp') ?? null,
    lookup: req.get('x-ip2location-lookup') ?? null,
  });
});
```

The origin receives these headers on the **incoming request**. The Worker does not automatically add them to the HTTP response returned to the visitor.

## Default enrichment headers

These are the enrichment headers selected by `DEFAULT_FIELDS` in [`src/fields.ts`](src/fields.ts) and used by the Worker in [`src/index.ts`](src/index.ts). The minimum-plan column follows the existing repository's plan-coverage documentation; it is not a guarantee that every IP lookup returns a value.

| Header | What it represents | Minimum plan indicated by existing README* |
| --- | --- | --- |
| `X-IP2Location-Is-Proxy` | General proxy indicator | Keyless / Free |
| `X-IP2Location-ISP` | Internet service provider | Starter |
| `X-IP2Location-Domain` | Domain associated with the IP address | Starter |
| `X-IP2Location-Net-Speed` | Network speed classification | Starter |
| `X-IP2Location-Usage-Type` | Network usage category | Starter |
| `X-IP2Location-Country-Alpha3` | Three-letter country code | Plus |
| `X-IP2Location-Country-Currency` | Country currency code | Plus |
| `X-IP2Location-Country-Language` | Country language code | Plus |
| `X-IP2Location-Time-Offset` | GMT offset | Plus |
| `X-IP2Location-Time-Abbr` | Time zone abbreviation | Plus |
| `X-IP2Location-Time-DST` | Daylight saving time indicator | Plus |
| `X-IP2Location-Address-Type` | Anycast or unicast address classification | Plus |
| `X-IP2Location-Mobile-MCC` | Mobile country code | Plus |
| `X-IP2Location-Mobile-MNC` | Mobile network code | Plus |
| `X-IP2Location-Mobile-Brand` | Mobile network brand | Plus |
| `X-IP2Location-District` | District or county | Security |
| `X-IP2Location-AS-Domain` | Autonomous system domain | Security |
| `X-IP2Location-AS-Usage-Type` | Autonomous system usage category | Security |
| `X-IP2Location-AS-CIDR` | Autonomous system network range | Security |
| `X-IP2Location-Ads-Category` | IAB advertising category name | Security |
| `X-IP2Location-Fraud-Score` | IP fraud risk score | Security |
| `X-IP2Location-Proxy-Type` | Proxy type classification | Security |
| `X-IP2Location-Proxy-Provider` | Proxy provider name | Security |
| `X-IP2Location-Threat` | Threat categories associated with the IP | Security |
| `X-IP2Location-Proxy-Flags` | Comma-separated active proxy-related indicators | Security |

*Minimum plans are based on the original README's coverage matrix. Confirm current subscription entitlements and response fields with [IP2Location.io](https://www.ip2location.io/). The Worker omits unavailable, blank, or `-`-valued fields. Even with a Security plan, not every header will appear for every IP.*

### Diagnostic headers

| Header | What it represents | Availability |
| --- | --- | --- |
| `X-IP2Location-Lookup` | Lookup status: `hit`, `miss`, `error`, `invalid`, or `off` | Worker-generated on forwarded requests |
| `X-IP2Location-Error` | Error message, if lookup fails | Worker-generated only on failure |

Lookup states:

- `hit`: data was retrieved from the cache.
- `miss`: the API supplied data and caching was enabled, but no matching cached result existed.
- `off`: the API supplied data without caching.
- `error`: the API lookup or Worker failed.
- `invalid`: the client address was missing or was not a valid IP address.

### Additional fields defined in the source (not emitted by default)

The field registry in [`src/fields.ts`](src/fields.ts) defines additional headers, but **the Worker emits only the names enabled in `DEFAULT_FIELDS`**. These additional fields are not part of the default enrichment table:

| Group | Additional headers available in the field registry |
| --- | --- |
| Network and country | `X-IP2Location-Elevation`, `X-IP2Location-IDD-Code`, `X-IP2Location-Area-Code`, `X-IP2Location-Country-Demonym`, `X-IP2Location-Country-Capital`, `X-IP2Location-Country-TLD`, `X-IP2Location-Country-Currency-Symbol` |
| Proxy history | `X-IP2Location-Proxy-Last-Seen` |
| Individual proxy indicators | `X-IP2Location-Is-VPN`, `X-IP2Location-Is-Tor`, `X-IP2Location-Is-Data-Center`, `X-IP2Location-Is-Public-Proxy`, `X-IP2Location-Is-Web-Proxy`, `X-IP2Location-Is-Crawler`, `X-IP2Location-Is-AI-Crawler`, `X-IP2Location-Is-Residential-Proxy`, `X-IP2Location-Is-Privacy-Network`, `X-IP2Location-Is-Enterprise-Network`, `X-IP2Location-Is-Spammer`, `X-IP2Location-Is-Scanner`, `X-IP2Location-Is-Botnet`, `X-IP2Location-Is-Bogon` |

To emit one of these headers, edit `DEFAULT_FIELDS` in `src/fields.ts` to include its corresponding `key` from `FIELDS`, then redeploy. Plan entitlements and available API values still apply. By default, proxy booleans are instead represented collectively in `X-IP2Location-Proxy-Flags` (for example, `vpn,datacenter`). The combined flags header is absent if there are no `true` flags.

## Configuration

The repository provides defaults in [`wrangler.toml`](wrangler.toml):

| Variable | Default | Description |
| --- | --- | --- |
| `CACHE_TTL` | `3600` | Cache lifetime in seconds. Set to `0` to disable lookup caching. |
| `ALLOW_QUERY_IP` | `0` | Allow the diagnostic endpoint to accept an IP override using `?ip=`. |
| `TRUST_XFF` | `0` | Use `X-Forwarded-For` when `CF-Connecting-IP` is absent. Intended for local development only. |
| `ALLOWED_ORIGINS` | `*` | `Access-Control-Allow-Origin` value for the diagnostic endpoint. |
| `IP2LOCATION_API_KEY` | Secret (optional) | IP2Location.io API key, stored as a Cloudflare Worker secret. |

Values such as `1`, `true`, `yes`, and `on` enable the boolean options.

### Caching and API usage

The Worker uses a network-based cache key rather than caching each individual address:

- IPv4: `/24` network.
- IPv6: `/48` network.
- Default cache duration: one hour (`CACHE_TTL=3600`).

This reduces API traffic but means lookups for different addresses in the same network can reuse the same enrichment data. If precise per-address distinctions are important, assess the trade-off before using network-based caching.

If the API returns error code `10000` for an authenticated request, the Worker retries once without the key. The keyless fallback may supply fewer fields and is subject to its own rate limits. The source does not implement a generic retry for every HTTP or network failure.

## Developer integration examples

The following examples run **at your origin server**, after the Cloudflare Worker forwards the enriched request.

### PHP

```php
<?php
$isp = $_SERVER['HTTP_X_IP2LOCATION_ISP'] ?? null;
$lookup = $_SERVER['HTTP_X_IP2LOCATION_LOOKUP'] ?? null;
$flags = array_filter(explode(',', $_SERVER['HTTP_X_IP2LOCATION_PROXY_FLAGS'] ?? ''));
$isVpn = in_array('vpn', $flags, true);
$isProxy = ($_SERVER['HTTP_X_IP2LOCATION_IS_PROXY'] ?? '') === 'true';
```

### Node.js (Express)

```javascript
const isp = req.get('x-ip2location-isp') ?? null;
const lookup = req.get('x-ip2location-lookup') ?? null;
const flags = (req.get('x-ip2location-proxy-flags') ?? '').split(',');
const isVpn = flags.includes('vpn');
const isProxy = req.get('x-ip2location-is-proxy') === 'true';
```

### Python (Flask)

```python
from flask import request

isp = request.headers.get('X-IP2Location-ISP')
lookup = request.headers.get('X-IP2Location-Lookup')
flags = request.headers.get('X-IP2Location-Proxy-Flags', '').split(',')
is_vpn = 'vpn' in flags
is_proxy = request.headers.get('X-IP2Location-Is-Proxy') == 'true'
```

Missing headers should be treated as **unknown or unavailable**, not automatically as negative classifications.

## Local development

1. Copy `.dev.vars.example` to `.dev.vars` and insert your API key.
2. Install project dependencies.
3. Start the local Worker.

```bash
cp .dev.vars.example .dev.vars
npm install
npm run dev
```

The example file enables `TRUST_XFF=1` and `ALLOW_QUERY_IP=1` for local testing. Do not carry those settings into production without assessing their security implications.

Run validation using the scripts included with the repository:

```bash
npm run typecheck
bun test
bun run live 8.8.8.8
```

The live-check command contacts the IP2Location.io API and may consume lookup quota.

## Debugging

The Worker reserves `GET /__ip2location` to return diagnostic JSON with the client IP, lookup state, network cache key, emitted enrichment headers, and API response data.

When running the local Worker and `ALLOW_QUERY_IP=1`:

```bash
curl "http://127.0.0.1:8787/__ip2location?ip=8.8.8.8"
```

Check the actual local port printed by Wrangler; it can vary. If `ALLOW_QUERY_IP=0`, `?ip=` is ignored. **The endpoint itself remains accessible** unless you add access controls.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No enrichment headers at the origin | Confirm the Worker is deployed, its route matches the request, and the origin is reached through Cloudflare. |
| `X-IP2Location-Lookup: invalid` | Verify the visitor IP is present in `CF-Connecting-IP`. `TRUST_XFF` is intended only for controlled local tests. |
| `X-IP2Location-Lookup: error` | Inspect `X-IP2Location-Error`, API credentials, lookup quota, and outbound API access. |
| Some fields are missing | Check the API plan, the actual response value, and whether the field is included in `DEFAULT_FIELDS`. |
| `X-IP2Location-Is-Bogon` is absent | It is registered in `FIELDS` but not selected by default; inspect `X-IP2Location-Proxy-Flags` or explicitly enable it. |
| Different IPs return similar data | Network-based caching shares responses within IPv4 `/24` and IPv6 `/48` networks. |
| `?ip=` does not change the debug lookup | Set `ALLOW_QUERY_IP=1` only in a controlled development environment. |

## Security and responsible use

- **Trust boundary:** The Worker removes incoming `X-IP2Location-*` request headers before setting its own values. Protect direct origin access so untrusted clients cannot bypass Cloudflare and submit forged headers.
- **Secrets:** Keep `IP2LOCATION_API_KEY` in Worker secrets or local `.dev.vars`, never in committed configuration or client-side code.
- **Debug endpoint:** `/__ip2location` can expose lookup data. `ALLOW_QUERY_IP=0` prevents arbitrary IP selection but does not disable the endpoint. Protect it separately if necessary.
- **CORS:** Restrict `ALLOWED_ORIGINS` when cross-origin diagnostic access is unnecessary.
- **Interpretation:** IP geolocation is approximate, not GPS. Proxy indicators and fraud scores are signals, not definitive proof of malicious activity; use other evidence before taking consequential action.

## Resources

- [IP2Location.io](https://www.ip2location.io/)
- [IP2Location.io API documentation](https://www.ip2location.io/ip2location-documentation)
- [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
- [Wrangler documentation](https://developers.cloudflare.com/workers/wrangler/)
- [Issues and feature requests](https://github.com/ip2location/cf-ip2location-headers/issues)

## Contributing

Contributions and bug reports are welcome. Open an issue to discuss a change, or submit a pull request with a clear description and relevant tests.

