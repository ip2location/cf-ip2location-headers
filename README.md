# cf-ip2location-headers

A Cloudflare Worker that enrich the origin request with additional IP2Location.io geolocation records as headers.



## Why only some fields

Cloudflare already tells the origin: `country`, `city`, `region`, `regionCode`, `continent`, `latitude`, `longitude`, `postalCode`, `metroCode`, `timezone`, `asn` and `asOrganization`.

This Worker adds **only what `request.cf` does not carry**, so nothing is duplicated. Everything below comes from the Security plan.

| Header | Notes |
| --- | --- |
| `X-IP2Location-District` | County / district |
| `X-IP2Location-Country-Alpha3` | `USA` |
| `X-IP2Location-Country-Currency` | `USD`, useful for localised pricing |
| `X-IP2Location-Country-Language` | `EN` |
| `X-IP2Location-Time-Offset` | GMT offset in seconds |
| `X-IP2Location-Time-Abbr` | `PST` |
| `X-IP2Location-Time-DST` | DST state |
| `X-IP2Location-ISP` |  |
| `X-IP2Location-Domain` | |
| `X-IP2Location-Net-Speed` | `DIAL` `DSL` `COMP` `T1` `SAT` |
| `X-IP2Location-Usage-Type` | `COM` `ISP` `MOB` `DCH` `SES` `AIC`, etc... |
| `X-IP2Location-Address-Type` | `Anycast` / `Unicast` |
| `X-IP2Location-AS-Domain` | |
| `X-IP2Location-AS-Usage-Type` | |
| `X-IP2Location-AS-CIDR` | AS range of the IP |
| `X-IP2Location-Mobile-MCC` / `-MNC` / `-Brand` |  |
| `X-IP2Location-Ads-Category` | IAB v3.1 |
| `X-IP2Location-Is-Proxy` | |
| `X-IP2Location-Fraud-Score` | 0-99 |
| `X-IP2Location-Proxy-Type` | `VPN` `TOR` `DCH` `PUB` `RES` `AIC` … |
| `X-IP2Location-Proxy-Provider` | e.g. `CyberGhost` |
| `X-IP2Location-Threat` | `SPAM` `SCANNER` `BOTNET` `BOGON` |
| `X-IP2Location-Proxy-Flags` | Comma-joined true flags, e.g. `vpn,ai-crawler` |



Header for diagnose, always present:

| Header | Values |
| --- | --- |
| `X-IP2Location-Lookup` | `hit` `miss` `error` `invalid` `off` |
| `X-IP2Location-Error` | Only on failure |



### Example

A Security-plan key looking up `8.8.8.8`:

```text
X-IP2Location-Lookup: miss
X-IP2Location-District: Santa Clara County
X-IP2Location-Ads-Category: Web Hosting
X-IP2Location-Country-Alpha3: USA
X-IP2Location-Country-Currency: USD
X-IP2Location-Country-Language: EN
X-IP2Location-Time-Offset: -25200
X-IP2Location-Time-Abbr: PST
X-IP2Location-Time-DST: true
X-IP2Location-ISP: Google LLC
X-IP2Location-Domain: google.com
X-IP2Location-Net-Speed: T1
X-IP2Location-Usage-Type: DCH
X-IP2Location-Address-Type: Anycast
X-IP2Location-AS-Domain: google.com
X-IP2Location-AS-Usage-Type: DCH
X-IP2Location-AS-CIDR: 8.8.8.0/24
X-IP2Location-Is-Proxy: false
X-IP2Location-Fraud-Score: 0
X-IP2Location-Proxy-Type: DCH
X-IP2Location-Proxy-Flags: datacenter
```

Reproduce it with `bun run live 8.8.8.8`, or `curl "http://127.0.0.1:8788/__ip2location?ip=8.8.8.8"` against `wrangler dev`.



## Plan coverage

The API returns a different field set per plan, and the Worker only emits a header when the field is actually present. Sign up for a free API key from [https://www.ip2location.io](https://www.ip2location.io/?utm_source=cf-ip2location).

| Header (`X-IP2Location-…`) | Keyless / Free | Starter | Plus | Security |
| --- | :--: | :--: | :--: | :--: |
| `Is-Proxy` | Yes | Yes | Yes | Yes |
| `ISP`, `Domain`, `Net-Speed`, `Usage-Type`, `IDD-Code`, `Area-Code`, `Elevation` | No | Yes | Yes | Yes |
| `Country-Alpha3`, `Country-Demonym`, `Country-Capital`, `Country-TLD`, `Country-Currency`, `Country-Currency-Symbol`, `Country-Language` | No | No | Yes | Yes |
| `Time-Offset`, `Time-Abbr`, `Time-DST` | No | No | Yes | Yes |
| `Address-Type` | No | No | Yes | Yes |
| `Mobile-MCC`, `Mobile-MNC`, `Mobile-Brand` | No | No | Yes | Yes |
| `District` | No | No | No | Yes |
| `AS-Domain`, `AS-Usage-Type`, `AS-CIDR` | No | No | No | Yes |
| `Ads-Category` | No | No | No | Yes |
| `Fraud-Score` | No | No | No | Yes |
| `Proxy-Type`, `Proxy-Provider`, `Threat`, `Proxy-Last-Seen`, `Proxy-Flags` | No | No | No | Yes |
| `Is-VPN`, `Is-Tor`, `Is-Data-Center`, `Is-Public-Proxy`, `Is-Web-Proxy`, `Is-Crawler`, `Is-AI-Crawler`, `Is-Residential-Proxy`, `Is-Privacy-Network`, `Is-Enterprise-Network`, `Is-Spammer`, `Is-Scanner`, `Is-Botnet`, `Is-Bogon` | No | No | No | Yes |

`Lookup` and `Error` come from the Worker, not the API, and appear on every tier.

**Missing fields are omitted, not empty.** A header is set only when the field is present and not `-`. For example `Mobile-MCC` is absent for fixed-line visitors even on Security plan.



## Deploy

```bash
wrangler secret put IP2LOCATION_API_KEY     # Never put it in wrangler.toml
wrangler deploy
```

Then add a route for the zone (Workers → your Worker → Settings → Triggers → Add route), e.g. `shop.example.com/*`. Leave the `[vars]` defaults alone unless you need to change them.



## Configuration

| Var | Default | Meaning |
| --- | --- | --- |
| `CACHE_TTL` | `3600` | Seconds a lookup stays cached. `0` = one API call per request |
| `ALLOW_QUERY_IP` | `0` | Allow `?ip=` on the debug endpoint |
| `TRUST_XFF` | `0` | Let X-Forwarded-For stand in for `CF-Connecting-IP`. Local dev only |
| `ALLOWED_ORIGINS` | `*` | CORS origin for the debug endpoint |



## Disclamation

Free plan is 50,000 queries/month; keyless is 1,000/day. Lookups are cached **by network, not by address**: every visitor in a /24 or /48 shares one entry, so a busy shop makes roughly one call per network per hour. 

If the key is rejected or the quota runs out (error 10000) the Worker automatically retries once **without** the key.



## Access the Headers in Web Applications

#### PHP

```php
$isp     = $_SERVER['HTTP_X_IP2LOCATION_ISP'] ?? null;
$flags   = $_SERVER['HTTP_X_IP2LOCATION_PROXY_FLAGS'] ?? '';
$isProxy = $_SERVER['HTTP_X_IP2LOCATION_IS_PROXY'] === 'true';
$isVpn   = str_contains($flags, 'vpn');
```



#### Node.js

```js
const isp     = req.get('x-ip2location-isp');
const flags   = req.get('x-ip2location-proxy-flags') ?? '';
const isProxy = req.get('x-ip2location-is-proxy') === 'true';
const isVpn   = flags.split(',').includes('vpn');
```



#### Python

```python
isp      = request.headers.get('X-IP2Location-ISP')
flags    = request.headers.get('X-IP2Location-Proxy-Flags', '')
is_proxy = request.headers.get('X-IP2Location-Is-Proxy') == 'true'
is_vpn   = 'vpn' in flags.split(',')
```



## Debug Endpoint

`GET /__ip2location` returns the caller's lookup: the headers that would be sent, plus the raw payload. `?ip=` only works when `ALLOW_QUERY_IP=1`, so the endpoint cannot be used to burn quota.

```bash
curl "http://127.0.0.1:8788/__ip2location?ip=8.8.8.8"
```



## Local Development

```bash
cp .dev.vars.example .dev.vars     # Insert your API key
npm install
bun test
bun x tsc --noEmit
bun run live
wrangler dev
```
