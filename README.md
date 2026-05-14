# EPP Testing Tool

EPP service for integration testing with a web dashboard and optional persistent storage.

## Design

The project separates four responsibilities:

- `src/epp`: TCP transport, EPP framing, XML, sessions, and command routing.
- `src/domain`: domain rules and the `DomainRepository` contract.
- `src/domain/sqliteDomainRepository.ts`: persistent SQLite storage.
- `src/domain/inMemoryDomainRepository.ts`: in-memory storage for quick tests.
- `src/control`: HTTP API to manage fixtures, reset state, and inspect received commands.

The EPP protocol does not depend on the storage layer. To move from SQLite to PostgreSQL later, add an implementation such as `PostgresDomainRepository` that satisfies `DomainRepository` and wire it in `src/index.ts`.

## Supported Commands

- `login`
- `logout`
- `domain:check`
- `domain:create`
- `domain:info`
- `domain:update`
- `domain:delete`
- `domain:renew`
- `domain:transfer` with `request`, `approve`, `reject`, `cancel`, and `query`
- `poll`
- `hello`

Domain records support nameservers, registrant contact, admin/tech/billing contacts, `authInfo`, creation/update/expiration timestamps, transfer state, and statuses such as:

- `clientTransferProhibited`
- `clientUpdateProhibited`
- `pendingTransfer`
- `pendingDelete`
- `ok`

## Configuration

Available variables:

- `EPP_HOST`, default `127.0.0.1`
- `EPP_PORT`, default `7000`
- `CONTROL_HOST`, default `127.0.0.1`
- `CONTROL_PORT`, default `8080`
- `GREETING_SERVER_ID`, default `epp-testing-tool`
- `EPP_USERS`, optional JSON array of `{ "clid": "...", "password": "..." }`
- `EPP_CLID` / `EPP_PASSWORD`, optional legacy override for the first default user
- `RESET_HTTP_USER`, default `admin`
- `RESET_HTTP_PASSWORD`, default `reset-secret`
- `STORAGE_MODE`, default `sqlite`, values: `sqlite` or `memory`
- `SQLITE_PATH`, default `data/epp-testing-tool.sqlite`

Default EPP login users:

- `melendez-admin` / `admin-secret`
- `melendez-registrar` / `registrar-secret`
- `melendez-tester` / `tester-secret`

## Usage

```bash
npm install
npm run dev
```

The EPP server listens on `127.0.0.1:7000`, and the control API listens on `127.0.0.1:8080`.

By default, domains are persisted in `data/epp-testing-tool.sqlite`. The `data/` directory is created automatically and is not versioned in git.

Open the web dashboard at:

```bash
http://127.0.0.1:8080
```

From there, you can create EPP requests with templates, send them to the TCP server, and view the greeting, login response, and command response.

## Control API

```bash
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/domains
curl http://127.0.0.1:8080/domains.csv
curl 'http://127.0.0.1:8080/dns/zone?dnssec=true&keyAction=generate&nsec3Hash=1&nsec3Flags=0&nsec3Iterations=10&nsec3Salt=A1B2C3D4'
curl http://127.0.0.1:8080/commands
```

The dashboard also includes a **Download CSV** button for exporting the full domain table.
It also includes a **DNS Zone** section for generating and downloading a BIND-style `.melendez` TLD zone file with optional DNSSEC KSK/ZSK records, key renewal mode, DS records, and NSEC3 parameters.
The **Help** section documents the available site features and supported EPP commands.

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

## Next Step Toward PostgreSQL

Keep the EPP handlers intact and replace only the repository:

```ts
const domainRepository = new PostgresDomainRepository(pool);
const domainService = new DomainService(domainRepository);
```

Then add migrations for `registrars`, `domains`, `contacts`, `hosts`, `poll_messages`, and `epp_command_log`.
