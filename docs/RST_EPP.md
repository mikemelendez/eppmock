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
| `epp.secDNSInterfaces` | `keyData` or `dsData` (both supported; `keyData` is echoed alone on info — never mixed with `dsData` — and also converted to SHA-256 DS for the zone; only flags `257` accepted) |
| `epp.supportedContactPostalInfoTypes` | `both` |
| `epp.clid01` / `epp.clid02` | `melendez-reg` / `melendez-tester` (or any two distinct `EPP_USERS` clIDs; each clID must be 3–16 chars) |
| `epp.registeredNames` | one existing domain **not** sponsored by those two clients (e.g. `example.melendez`, sponsored by `melendez-admin`) |
| `epp.registeredContacts` | at least two existing contact ids, e.g. `melendez-ct1` / `melendez-ct2` (preferred, ≤16) or `melendez-contact1` / `melendez-contact2` (also seeded for legacy RST input) or `NIC-001` / `EXA-001` |

## Protocol coverage (implemented here)

| Case | What the server does |
| --- | --- |
| epp-02 | Greeting with `1.0`/`en`, domain/contact/host objects, `secDNS-1.1`, `rgp-1.0`, `launch-1.0` |
| epp-03 | Login rejects unknown clID, bad password, missing/wrong/other-registrar client certs (when TLS + fingerprints are configured) |
| epp-04–06 | check with mixed names: registered/reserved/pattern-invalid → `avail=0`, free → `avail=1`; **unknown** contact ids outside clIDType length 3–16 return **2005** (must not echo schema-invalid ids). Seeded `epp.registeredContacts` (including legacy `melendez-contact1/2`) return **1000** with `avail=0` |
| epp-07 / epp-09 | Contact create/update validate clID (3–16), postal lines ≤255, email local ≤64, ISO country, voice/fax; update statuses limited to client*; info round-trips values and an IANA ROID (`*-ICANNRST`) |
| epp-08 / epp-12 | Non-sponsoring clients get `2201` on contact/host info and update |
| epp-10 / epp-24 | Delete returns `1000` and a later info is `2303` |
| epp-11 / epp-13 | Internal hosts need a superordinate domain + public glue; external hosts may be glueless; `v5`/empty/loopback/`::1` rejected |
| epp-14 | Domain create requires registrant, host **objects** (not attributes), existing hosts/contacts, period 1–10y, valid `dsData` or `keyData` (keyData-only on info when that interface is used; DS still derived for the zone); info has `roid`/`clID`/`crID`. ROID repository suffix must be IANA-registered — see below |
| epp-15 | Linked contact/host delete returns `2305` |
| epp-16 | Domain update of NS/status/DS/keyData (flags `256` rejected); non-sponsor may `info` (authInfo omitted unless pw matches); other registrar `update` gets `2201` |
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
| epp-01 | Public `A` + TCP 700 + browser-trusted SAN are in place. Optionally add `AAAA`. When ICANN publishes `epp.clientACL`, restrict SG 700 to those IPs. Each TLS connect logs the peer leaf/chain (`TLS client cert session=…`) so RST normal / unordered / extraneous presentations are visible in app logs. |
| epp-03 | Put RST client-cert SHA-256 fingerprints on `melendez-registrar` / `melendez-tester` in GitHub `EPP_USERS` (`./deploy/fingerprint-cert.sh client.pem`), then redeploy. Until then, greeting on 700 works; TLS login is rejected. Dashboard login does not need a client cert. |
| epp-17 | One instance must serve every `A`/`AAAA` (no second proxy in front of 700). |

Example `EPP_USERS` after ICANN issues certs (keep the passwords you already use):

```
[{"clid":"melendez-admin","password":"..."},{"clid":"melendez-registrar","password":"...","clientCertSha256":"..."},{"clid":"melendez-tester","password":"...","clientCertSha256":"..."}]
```

### EPP repository ID (`EPP_REPOSITORY_ID`) — epp-14 ROID suffix

ROIDs look like `D8E5CF8F8ACD1-ICANNRST`. The suffix after `-` must appear in the
[IANA EPP Repository Identifiers](https://www.iana.org/assignments/epp-repository-ids/)
registry. RST returns `EPP_DOMAIN_CREATE_INFO_RESPONSE_INVALID_ROID` when it does not.

| Test plan | Repository ID |
| --- | --- |
| **`StandardEPPOnly` / RSP evaluation / OT&E** | Default `ICANNRST` is IANA-registered (2025-04-17) and **MAY** be used ([RST §2.8](https://icann.github.io/rst-test-specs/v2026.07/rst-test-specs.html)). If RST still reports it as unregistered, that is an RST/IANA lookup bug — workaround: use your own registered id (below). |
| **Pre-Delegation / post-delegation (production)** | `ICANNRST` **MUST NOT** be used. Register your own id and set `EPP_REPOSITORY_ID`. |

```bash
# After IANA registers MELENDEZ (or similar ≤8 letters/digits):
EPP_REPOSITORY_ID=MELENDEZ
```

New objects pick up the new suffix immediately after redeploy. Existing SQLite rows
keep their old ROIDs until recreated.

IANA registration (FCFS): email IANA using the template on
[epp-repository-ids](https://www.iana.org/assignments/epp-repository-ids/)
(e.g. `MELENDEZ, #x004D #x0045 #x004C #x0045 #x004E #x0044 #x0045 #x005A`).

## Intentionally not implemented

- RFC 9154 empty/secure authInfo (the extension is **not** advertised, so RST will not require it)
- RFC 8807 Login Security (not advertised)
- Recommended greeting extensions (`loginSec`, `changePoll`, `unhandled-namespaces`, `secure-authinfo-transfer`) — RST treats these as warnings
- Live DNS / RDAP / RDE / IDN suites — those are separate RST suites, not `StandardEPP`
