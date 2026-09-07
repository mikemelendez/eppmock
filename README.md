# EPP Testing Tool

Registry mock for the fictional TLD `.melendez`: EPP (RFC 5730–5734), WHOIS, RDAP, a signed zone file, and a web dashboard. Production at `eppmock.melendez.mx` is set up for ICANN RST `StandardEPP`.

## Architecture

`src/index.ts` starts one registry process with several listeners. Object rules live in `src/domain`, `src/contact`, and `src/host`. Storage is swapped behind repository interfaces (SQLite or in-memory).

| Path | Role |
| --- | --- |
| `src/epp` | TCP/TLS transport, RFC 5734 framing, XML, sessions, command handlers |
| `src/domain` / `src/contact` / `src/host` | Object policy and repositories |
| `src/registry` | Cross-object links (linked delete, host objects, glue) |
| `src/control` | Dashboard and HTTP control API |
| `src/dns` | `.melendez` zone **file** generation and DNSSEC signing (not a live nameserver; see `docs/RST_DNS.md`) |
| `src/whois` | TCP WHOIS (port 43) |
| `src/rdap` | RDAP JSON (internal 8090; public via Caddy `/rdap`) |

EPP handlers do not import SQLite. To move to PostgreSQL later, add repository implementations and wire them in `src/index.ts`.

### Listeners

Local `npm run dev` (no TLS):

| Port | Service |
| --- | --- |
| `127.0.0.1:7000` | EPP (plaintext) |
| `127.0.0.1:43` | WHOIS |
| `127.0.0.1:8080` | Dashboard and control API |
| `127.0.0.1:8090` | RDAP |

AWS (`deploy/docker-compose.aws.yml`):

| Port | Service |
| --- | --- |
| `700` public | EPP TLS 1.2–1.3 (IANA EPP). Node uses Caddy’s Let’s Encrypt cert for `eppmock.melendez.mx`. Login may require a client certificate (`EPP_TLS_REQUIRE_CLIENT_CERT`). |
| `7000` localhost only | Same EPP registry, plaintext, for the dashboard. Password login only; not published. |
| `43` public | WHOIS |
| `80` / `443` | Caddy → dashboard `8080` and RDAP `8090` |

The dashboard never connects to public port 700. `src/epp/eppClient.ts` uses `EPP_DASHBOARD_HOST` / `EPP_DASHBOARD_PORT` when that port differs from `EPP_PORT`.

## Supported Commands

- `login`
- `logout`
- `domain:check`
- `domain:create`, including optional `secDNS` DS data
- `domain:info`, including `secDNS:infData` when DS records exist
- `domain:update`, including `secDNS` DS add/remove
- `domain:delete`
- `domain:renew`
- `domain:transfer` with `request`, `approve`, `reject`, `cancel`, and `query`
- `contact:check`, `contact:create`, `contact:info`, `contact:update`, `contact:delete` (RFC 5733)
- `host:check`, `host:create`, `host:info`, `host:update`, `host:delete` with IPv4/IPv6 glue (RFC 5732)
- `poll` with a per-registrar `<msgQ>` message queue (1301/ack)
- `hello`

EPP extensions: `secDNS` (RFC 5910), `rgp` (RFC 3915 redemption/restore), and `launch` (RFC 8334 Sunrise/Claims). Login validates `<version>`/`<lang>`/`<svcs>` and all responses echo `clTRID`.

Domain records support nameservers, registrant contact, admin/tech/billing contacts, `authInfo`, creation/update/expiration timestamps, transfer state, RGP status, and statuses such as:

- `clientTransferProhibited`
- `clientUpdateProhibited`
- `pendingTransfer`
- `pendingDelete`
- `ok`

The registry accepts only second-level `.melendez` domains. Unicode IDNs are accepted and stored canonically as punycode, for example `café.melendez` is stored as `xn--caf-dma.melendez`.

## Configuration

Available variables:

- `EPP_HOST` / `EPP_PORT`, default `127.0.0.1:7000`. AWS compose binds `0.0.0.0:700` with TLS
- `EPP_DASHBOARD_HOST` / `EPP_DASHBOARD_PORT`, optional second EPP listener (plaintext). Set in AWS to `127.0.0.1:7000` so the dashboard can log in without a client certificate
- `WHOIS_HOST`, default `127.0.0.1`
- `WHOIS_PORT`, default `43`
- `CONTROL_HOST`, default `127.0.0.1`
- `CONTROL_PORT`, default `8080`
- `RDAP_HOST`, default `127.0.0.1`
- `RDAP_PORT`, default `8090`
- `GREETING_SERVER_ID`, default `epp-testing-tool`
- `REGISTRY_TLD`, default `melendez`
- `EPP_USERS`, optional JSON array of `{ "clid": "...", "password": "...", "clientCertSha256": "..." }`
- `EPP_CLID` / `EPP_PASSWORD`, optional legacy override for the first default user
- `EPP_TLS_CERT` / `EPP_TLS_KEY` / `EPP_TLS_CA`, optional PEM paths; when cert+key are set the EPP port uses TLS 1.2+ (RFC 5734)
- `EPP_TLS_REQUIRE_CLIENT_CERT`, default `true` when TLS is enabled. Enforced on **TLS sessions only** (RST epp-03). The dashboard plaintext listener still uses password login
- `EPP_REPOSITORY_ID`, default `ICANNRST` (IANA id used in ROIDs)
- `RESET_HTTP_USER`, default `admin`
- `RESET_HTTP_PASSWORD`, default `reset-secret`
- `STORAGE_MODE`, default `sqlite`, values: `sqlite` or `memory`
- `SQLITE_PATH`, default `data/epp-testing-tool.sqlite`
- `DNSSEC_KEY_PATH`, default `data/dnssec-keys.json`

When `NODE_ENV=production`, `RESET_HTTP_PASSWORD` must be changed from defaults and `EPP_USERS` must be explicitly set.

Default EPP login users:

- `melendez-admin` / `admin-secret`
- `melendez-registrar` / `registrar-secret`
- `melendez-tester` / `tester-secret`

## Usage

```bash
npm install
npm run dev
```

EPP listens on `127.0.0.1:7000` (plaintext), WHOIS on `127.0.0.1:43`, the dashboard on `127.0.0.1:8080`, and RDAP on `127.0.0.1:8090`.

By default, domains are persisted in `data/epp-testing-tool.sqlite`. The `data/` directory is created automatically and is not versioned in git.

Open the web dashboard at:

```bash
http://127.0.0.1:8080
```

Use **Auto login** so the dashboard sends `login` before your command. That path talks to the local EPP port, not to public TCP 700.

## Control API

```bash
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/domains
curl http://127.0.0.1:8080/domains.csv
curl 'http://127.0.0.1:8080/dns/zone?dnssec=true&keyAction=generate&nsec3Hash=1&nsec3Flags=0&nsec3Iterations=0&nsec3Salt=-'
curl http://127.0.0.1:8080/commands
```

The dashboard also includes a **Download CSV** button for exporting the full domain table.
It also includes a **DNS Zone** section for generating and downloading a BIND-style `.melendez` TLD zone file with DNSSEC KSK/ZSK records, DS records, RRSIG signatures, NSEC3 records, key renewal mode, and NSEC3 parameters.
The **Help** section documents the available site features and supported EPP commands.

WHOIS can be queried directly over TCP:

```bash
printf 'example.melendez\r\n' | nc 127.0.0.1 43
printf 'café.melendez\r\n' | nc 127.0.0.1 43
printf 'xn--caf-dma.melendez\r\n' | nc 127.0.0.1 43
```

You can also send EPP XML over HTTP:

```bash
curl -X POST http://127.0.0.1:8080/epp/request \
  -H 'content-type: application/json' \
  -d '{"autoLogin":true,"xml":"<?xml version=\"1.0\" encoding=\"UTF-8\"?><epp xmlns=\"urn:ietf:params:xml:ns:epp-1.0\"><command><check><domain:check xmlns:domain=\"urn:ietf:params:xml:ns:domain-1.0\"><domain:name>example.melendez</domain:name></domain:check></check><clTRID>demo</clTRID></command></epp>"}'
```

Reset with fixtures, protected with HTTP Basic Auth:

```bash
curl -X POST http://127.0.0.1:8080/reset \
  -u admin:reset-secret \
  -H 'content-type: application/json' \
  -d '{
    "domains": [
      {
        "name": "example.melendez",
        "registrarId": "melendez-registrar",
        "periodYears": 1,
        "statuses": ["ok"],
        "createdAt": "2026-01-01T00:00:00.000Z",
        "expiresAt": "2027-01-01T00:00:00.000Z"
      }
    ]
  }'
```

Reset the entire domain table:

```bash
curl -X POST http://127.0.0.1:8080/admin/domains/reset \
  -u admin:reset-secret
```

The dashboard **Reset** button prompts for the same HTTP Basic Auth credentials.

## Testing

```bash
npm test
```

The suite includes RST `StandardEPP` cases in `src/epp/rstEppConformance.test.ts` and TLS 1.2 / client-certificate login in `src/epp/tlsAuth.test.ts`, plus config, secDNS, RDAP, WHOIS, and signed-zone tests.

## Persistence

Persistent mode uses SQLite:

```bash
STORAGE_MODE=sqlite SQLITE_PATH=data/epp-testing-tool.sqlite npm run dev
```

To run without persistence:

```bash
STORAGE_MODE=memory npm run dev
```

The `POST /reset` endpoint deletes persisted domains and loads the submitted fixtures, so use it carefully if you want to keep existing data.

DNSSEC KSK/ZSK material is stored at `DNSSEC_KEY_PATH`. Keep that file in persistent storage and back it up with the SQLite database.

## RDAP

An RDAP (Registration Data Access Protocol) HTTP service runs on `RDAP_PORT` (default `8090`) and returns RFC 9083 JSON with the `application/rdap+json` content type:

- `GET /domain/{name}` - domain object (status, events, nameservers, `secureDNS`, registrar entity)
- `GET /nameserver/{name}` - nameserver object with `ipAddresses.v4` / `ipAddresses.v6`
- `GET /entity/{handle}` - contact (registrant) or registrar entity with a jCard `vcardArray`
- `GET /help` - service help and notices

Unknown objects return an RDAP error object (404), and malformed queries return 400. Every response includes `rdapConformance`.

```bash
curl http://127.0.0.1:8090/domain/example.melendez
curl http://127.0.0.1:8090/nameserver/ns1.example.melendez
```

## Compliance

A gap analysis mapping this tool against the technically relevant parts of the ICANN Base Registry Agreement (Specifications 6, 4, and 10) is in `docs/ICANN_COMPLIANCE.md`. Mapping against ICANN Registry System Testing (RST) v2026.06 EPP cases is in `docs/RST_EPP.md`. Authoritative DNS / DNSSEC nameservers are a separate RST suite **and a separate project**; this repo only exports the zone (`docs/RST_DNS.md`).

## AWS Deployment

Deployment is configured for AWS EC2 using Docker Compose, Caddy, and GitHub Actions.

See `docs/AWS_DEPLOYMENT.md` for EC2, secrets, and security-group ports. Public EPP is `eppmock.melendez.mx:700` (TLS). RST parameters are in `docs/RST_EPP.md`.

## Next Step Toward PostgreSQL

Keep the EPP handlers intact and replace only the repository:

```ts
const domainRepository = new PostgresDomainRepository(pool);
const domainService = new DomainService(domainRepository);
```

Then add migrations for `registrars`, `domains`, `contacts`, `hosts`, `poll_messages`, and `epp_command_log`.
