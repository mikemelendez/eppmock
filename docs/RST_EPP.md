# ICANN RST v2026.06 — EPP suite status

Reference: [RST Test Specifications v2026.06](https://icann.github.io/rst-test-specs/v2026.06/rst-test-specs.html)
(`StandardEPP`, cases `epp-01` … `epp-27`).

This tool is a mock registry for `.melendez`. It can satisfy the **protocol**
cases in the EPP suite when deployed with TLS and two registrar accounts. It
cannot by itself satisfy the **operational** cases that need public DNS, a
browser-trusted certificate, IPv6, and the RST probe ACL.

## How the suite is configured for this server

Use these RST input parameters:

| Parameter | Value |
| --- | --- |
| `epp.hostModel` | `objects` |
| `general.registryDataModel` | `maximum` |
| `dns.gluePolicy` | `narrow` (only the superordinate sponsor may create in-bailiwick hosts, and those hosts require glue) |
| `epp.requiredContactTypes` | `[]` (registrant is required; admin/tech/billing are optional) |
| `epp.secDNSInterfaces` | `dsData` |
| `epp.supportedContactPostalInfoTypes` | `both` |
| `epp.clid01` / `epp.clid02` | two distinct users from `EPP_USERS` |
| `epp.registeredNames` | one existing domain **not** sponsored by those two clients |

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

## Operational requirements (not implemented in application code)

These will still fail RST until the **deployment** provides them:

| Case | Requirement |
| --- | --- |
| epp-01 | Hostname `A` (and ideally `AAAA`) records; TCP/700 with **TLS 1.2+ only** (1.1 and below are disabled); RFC 9325 TLS 1.2 ciphers; certificate from a public CA whose SAN matches `epp.hostName`; firewall allow-list for `epp.clientACL` |
| epp-03 | Map each RST registrar cert fingerprint into `EPP_USERS[].clientCertSha256` (or issue certs from the RST CSRs) |
| epp-17 | Every `A`/`AAAA` address for the EPP hostname must serve the same repository |

Set on the host (see `deploy/.env.example`):

```
EPP_TLS_CERT=/path/to/fullchain.pem
EPP_TLS_KEY=/path/to/privkey.pem
EPP_TLS_CA=/path/to/client-ca.pem   # optional; RST client certs are still accepted when unset
EPP_TLS_REQUIRE_CLIENT_CERT=true
EPP_REPOSITORY_ID=ICANNRST
EPP_USERS=[{"clid":"clid01","password":"...","clientCertSha256":"..."},{"clid":"clid02","password":"...","clientCertSha256":"..."}]
```

`ICANNRST` is the IANA repository id reserved for RST / RSP evaluation. Do **not**
use it on a production pre/post-delegation test; register a TLD-specific id.

## Intentionally not implemented

- RFC 9154 empty/secure authInfo (the extension is **not** advertised, so RST will not require it)
- RFC 8807 Login Security (not advertised)
- Recommended greeting extensions (`loginSec`, `changePoll`, `unhandled-namespaces`, `secure-authinfo-transfer`) — RST treats these as warnings
- Live DNS / RDAP / RDE / IDN suites — those are separate RST suites, not `StandardEPP`
