# ICANN RST v2026.06 — EPP suite status

Reference: [RST Test Specifications v2026.06](https://icann.github.io/rst-test-specs/v2026.06/rst-test-specs.html)
(`StandardEPP`, cases `epp-01` … `epp-27`).

This tool is a mock registry for `.melendez`. Protocol cases in `StandardEPP` are
implemented in-process (`npm test`). Production EPP is already TLS on
`eppmock.melendez.mx:700`. What ICANN still has to receive from you: registrar
client-certificate fingerprints and (when they publish it) `epp.clientACL`.

## How the suite is configured for this server

Use these RST input parameters:

| Parameter | Value |
| --- | --- |
| `epp.hostName` | `eppmock.melendez.mx` |
| `epp.hostModel` | `objects` |
| `general.registryDataModel` | `maximum` |
| `dns.gluePolicy` | `narrow` (only the superordinate sponsor may create in-bailiwick hosts, and those hosts require glue) |
| `epp.requiredContactTypes` | `[]` (registrant is required; admin/tech/billing are optional) |
| `epp.secDNSInterfaces` | `dsData` |
| `epp.supportedContactPostalInfoTypes` | `both` |
| `epp.clid01` / `epp.clid02` | `melendez-registrar` / `melendez-tester` (or any two distinct `EPP_USERS` clIDs) |
| `epp.registeredNames` | one existing domain **not** sponsored by those two clients (create it as `melendez-admin`) |

## Protocol coverage (implemented here)

| Case | What the server does |
| --- | --- |
| epp-02 | Greeting with `1.0`/`en`, domain/contact/host objects, `secDNS-1.1`, `rgp-1.0`, `launch-1.0` |
| epp-03 | Login rejects unknown clID, bad password, missing/wrong/other-registrar client certs (when TLS + fingerprints are configured) |
| epp-04–06 | check with mixed names in one command: registered/reserved/invalid → `avail=0`, free → `avail=1` (never a single 2005 for the whole check) |
| epp-07 / epp-09 | Contact create/update validate clID (3–16), ISO country, email, RFC 5733 voice/fax; info round-trips stored values and an IANA ROID (`*-ICANNRST`) |
| epp-08 / epp-12 | Non-sponsoring clients get `2201` on contact/host info and update |
| epp-10 / epp-24 | Delete returns `1000` and a later info is `2303` |
| epp-11 / epp-13 | Internal hosts need a superordinate domain + public glue; external hosts may be glueless; `v5`/empty/loopback/`::1` rejected |
| epp-14 | Domain create requires registrant, host **objects** (not attributes), existing hosts/contacts, period 1–10y, valid DS; info has `roid`/`clID`/`crID` |
| epp-15 | Linked contact/host delete returns `2305` |
| epp-16 | Domain update of NS/status/DS; other registrar gets `2201` |
| epp-18 | Renew extends expiry, sets `renewPeriod`, rejects expiry more than 10 years ahead; `curExpDate` must match when present |
| epp-19 / epp-20 | Transfer request needs authInfo (`2202` if wrong), `pendingTransfer`, approve/reject, `transferPeriod` on approve, 10-year cap |
| epp-21 | Fresh delete in add-grace purges the domain (`1000`); unlinked hosts/contacts can then be deleted |
| epp-23 | Host rename: invalid name rejected; external rename allowed; rename into another registrar's domain or a missing parent rejected |
| epp-25–27 | Narrow glue: only the superordinate sponsor can create in-bailiwick hosts, and those hosts require glue |

`npm test` includes `src/epp/rstEppConformance.test.ts` (in-process cases) and
`src/epp/tlsAuth.test.ts` (TLS 1.2 + client-certificate binding).

## Operational requirements (AWS)

EPP TLS on **TCP 700** uses Caddy’s Let’s Encrypt certificate for `eppmock.melendez.mx`.
Do **not** proxy EPP through Caddy. Details: `docs/AWS_DEPLOYMENT.md`.

| Case | Status / what remains |
| --- | --- |
| epp-01 | Public `A` + TCP 700 + browser-trusted SAN are in place. Optionally add `AAAA`. When ICANN publishes `epp.clientACL`, restrict SG 700 to those IPs. |
| epp-03 | Put RST client-cert SHA-256 fingerprints on `melendez-registrar` / `melendez-tester` in GitHub `EPP_USERS` (`./deploy/fingerprint-cert.sh client.pem`), then redeploy. Until then, greeting on 700 works; TLS login is rejected. Dashboard login does not need a client cert. |
| epp-17 | One instance must serve every `A`/`AAAA` (no second proxy in front of 700). |

Example `EPP_USERS` after ICANN issues certs (keep the passwords you already use):

```
[{"clid":"melendez-admin","password":"..."},{"clid":"melendez-registrar","password":"...","clientCertSha256":"..."},{"clid":"melendez-tester","password":"...","clientCertSha256":"..."}]
```

`ICANNRST` is the IANA repository id reserved for RST / RSP evaluation. Do **not**
use it on a production pre/post-delegation test; register a TLD-specific id.

## Intentionally not implemented

- RFC 9154 empty/secure authInfo (the extension is **not** advertised, so RST will not require it)
- RFC 8807 Login Security (not advertised)
- Recommended greeting extensions (`loginSec`, `changePoll`, `unhandled-namespaces`, `secure-authinfo-transfer`) — RST treats these as warnings
- Live DNS / RDAP / RDE / IDN suites — those are separate RST suites, not `StandardEPP`. For
  Authoritative DNS + DNSSEC, see [RST_DNS.md](RST_DNS.md).
