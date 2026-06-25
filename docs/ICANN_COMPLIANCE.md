# ICANN Base Registry Agreement - Compliance Gap Analysis

Reference document: ICANN Base Registry Agreement, new gTLD program draft (clean), 28 Feb 2026
(`agreement-draft-clean-28feb26-en.pdf`).

This report maps the agreement to the current state of the **EPP Testing Tool** in this
repository.

> **Update (implementation pass):** The technical remediation backlog in section 7 has been
> implemented. The tool now ships an **RDAP service**, **EPP contact (5733) and host (5732)
> objects**, **RGP (3915)**, **launch phase (8334)**, **EPP core polish (clTRID echo, login
> option/service validation, poll `<msgQ>`)**, the **WHOIS limited-data disclaimer**, a basic
> **IDN table**, and **IPv4/IPv6 glue** in zone generation. Status columns below reflect the
> post-implementation state; the original gaps are kept in italics for traceability.

## 1. Scope, disclaimer, and methodology

### What this tool is
This repository is a **local EPP mock / integration-testing tool**. It implements an EPP
server over TCP, a WHOIS service, a DNS zone generator, and a control/dashboard HTTP API for
the fictional `.melendez` TLD. It is **not** an operating gTLD registry and is not a party to
any agreement with ICANN.

### Why most of the agreement is Not Applicable
The Base Registry Agreement is a legal contract between a Registry Operator and ICANN. The
large majority of it governs legal, financial, and operational obligations (fees, escrow
agreements with third parties, monthly reporting through ICANN APIs, audits, indemnification,
arbitration, rights-protection programs, code of conduct, etc.). These obligations cannot be
"met" by a mock testing tool and are marked **N/A** with a one-line reason in section 5.

The substantive technical analysis therefore focuses on the parts of the agreement that
describe protocol/technical behavior an EPP tool can actually implement:

- **Specification 6** - Technical and operational standards (EPP, DNSSEC, IDN, IPv6)
- **Specification 4** - Registration Data Directory Services (RDAP and WHOIS)
- **Specification 10** - Registry performance specifications (SLRs)

### Status legend

| Status | Meaning |
| --- | --- |
| Met | Implemented and conformant for a mock/testing context |
| Partial | Implemented, but with conformance gaps |
| Missing | Not implemented |
| N/A | Legal/operational obligation outside a mock tool's scope |

### Method
Each requirement was checked against the source under `src/`. Evidence is cited with file
links. "Met" is judged against what is reasonable for a mock tool, not against running a
production, monitored, contractually-bound registry.

## 2. Specification 6 - Technical standards

### 2.1 EPP (Specification 6, Section 1.2)

The agreement requires conformance with RFCs **5910, 5730, 5731, 5732** (if using host
objects), **5733** (if using contact objects), **5734**, **3915** (if implementing RGP), and
**8334** (for Sunrise/Claims). Custom extensions must be documented per **RFC 3735**.

| RFC | Area | Status | Evidence / Notes |
| --- | --- | --- | --- |
| 5730 | EPP core (greeting, login, logout, poll, command framing) | Met (core) | Greeting/login/logout/poll in [src/epp/responses.ts](../src/epp/responses.ts), [src/epp/systemCommandHandler.ts](../src/epp/systemCommandHandler.ts), routing in [src/epp/commandRouter.ts](../src/epp/commandRouter.ts). `clTRID` echo, login option/service validation, and `<msgQ>` poll now implemented (see below). |
| 5731 | Domain name mapping | Met (core) | check/create/info/delete/update/renew/transfer in [src/epp/domainCommandHandler.ts](../src/epp/domainCommandHandler.ts), [src/epp/domainResponses.ts](../src/epp/domainResponses.ts). |
| 5732 | Host object mapping | Met | `host:check/create/info/update/delete` with IPv4/IPv6 glue and family validation: [src/epp/hostCommandHandler.ts](../src/epp/hostCommandHandler.ts), [src/epp/hostResponses.ts](../src/epp/hostResponses.ts), [src/host/](../src/host). |
| 5733 | Contact object mapping | Met | `contact:check/create/info/update/delete` with postalInfo/voice/fax/email/authInfo: [src/epp/contactCommandHandler.ts](../src/epp/contactCommandHandler.ts), [src/epp/contactResponses.ts](../src/epp/contactResponses.ts), [src/contact/](../src/contact). |
| 5910 | DNSSEC extension (secDNS) | Met | DS data on create/update and `secDNS:infData` on info: [src/epp/domainCommandHandler.ts](../src/epp/domainCommandHandler.ts), [src/epp/domainResponses.ts](../src/epp/domainResponses.ts). |
| 5734 | EPP transport over TCP | Met | 4-byte length-prefixed framing and greeting-on-connect: [src/epp/framing.ts](../src/epp/framing.ts), [src/epp/eppServer.ts](../src/epp/eppServer.ts). |
| 3915 | Registry Grace Period (RGP) | Met | Delete enters `redemptionPeriod` outside the add-grace window; `<rgp:restore>` request flow and `rgp:infData`/`rgp:upData` in [src/domain/domainService.ts](../src/domain/domainService.ts), [src/epp/domainCommandHandler.ts](../src/epp/domainCommandHandler.ts), [src/epp/domainResponses.ts](../src/epp/domainResponses.ts). |
| 8334 | Launch phase (Sunrise/Claims) | Met (core) | `launch` namespace handled on `domain:create` (returns `launch:creData` + applicationID) and `domain:check` (claims): [src/epp/domainCommandHandler.ts](../src/epp/domainCommandHandler.ts). |
| 3735 | EPP extension guidelines | N/A | Only standard extensions (secDNS, rgp, launch) are used; no custom/proprietary extension requiring an Internet-Draft. |

EPP core (RFC 5730) - implemented:

- **`clTRID` echoed in generic responses.** `resultResponse()` in
  [src/epp/responses.ts](../src/epp/responses.ts) now emits `clTRID` (when supplied) and a
  server-generated `svTRID`.
- **Login validates `<options>`/`<svcs>`.** [src/epp/authCommandHandler.ts](../src/epp/authCommandHandler.ts)
  returns 2100 for an unsupported `<version>`, 2102 for an unsupported `<lang>`, and 2307 for an
  unsupported object service URI.
- **Poll `<msgQ>` model.** [src/epp/pollMessageRepository.ts](../src/epp/pollMessageRepository.ts)
  backs a per-registrar message queue; [src/epp/systemCommandHandler.ts](../src/epp/systemCommandHandler.ts)
  returns 1301 with `<msgQ count=.. id=..>` on `poll op="req"` and dequeues on `op="ack"`. A
  domain transfer request enqueues a poll message for the sponsoring registrar.
- **Greeting service menu reflects real capability.** The greeting advertises
  `domain-1.0`/`contact-1.0`/`host-1.0` and the `secDNS`/`rgp`/`launch` extensions, all of
  which are now serviceable.

RFC 5731 remaining minor gaps:

- Pending statuses beyond client/server prohibitions are representable but not fully driven by a complete state machine (e.g. `pendingCreate`).
- `domain:check` with launch claims returns synthetic claim keys; it does not integrate with an external TMCH.

Status prohibitions (RFC 5731/5732/5733): `clientUpdateProhibited`, `serverUpdateProhibited`, `clientDeleteProhibited`, `serverDeleteProhibited`, and `clientTransferProhibited`/`serverTransferProhibited` are enforced in [src/epp/objectStatusPolicy.ts](../src/epp/objectStatusPolicy.ts) and wired through the domain, contact, and host services. Blocked operations return EPP result code **2304**. An update that only removes an update-prohibition status is permitted.

### 2.2 DNSSEC - DNS side (Specification 6, Section 1.3)

| Requirement | Status | Evidence / Notes |
| --- | --- | --- |
| DNSSEC per RFCs 4033-4035, 4509 (DS/SHA-256), 5155 (NSEC3) | Partial | Zone generation with DNSKEY (KSK/ZSK), RRSIG, NSEC3/NSEC3PARAM, and DS records: [src/dns/melendezZone.ts](../src/dns/melendezZone.ts), [src/dns/dnssecSigner.ts](../src/dns/dnssecSigner.ts), [src/dns/dnssecKeyStore.ts](../src/dns/dnssecKeyStore.ts). |
| Live signed authoritative DNS service | Missing | The tool generates a BIND-style zone file; it does not run a live signed authoritative server, and there is no automated key-rollover lifecycle. |

### 2.3 IDN (Specification 6, Section 1.4)

| Requirement | Status | Evidence / Notes |
| --- | --- | --- |
| IDNA conformance (RFCs 5890-5893) | Met (mock) | UTS-46 normalization to A-labels/U-labels via Node `domainToASCII`/`domainToUnicode` in [src/domain/registryPolicy.ts](../src/domain/registryPolicy.ts). Round-trips e.g. `cafe.melendez` <-> punycode. |
| IDN Tables + script/variant rules; publication in IANA Repository of IDN Practices; ICANN IDN Guidelines | Partial | A Latin-script IDN table now rejects U-labels with code points outside the registry repertoire ([src/domain/registryPolicy.ts](../src/domain/registryPolicy.ts)). Variant management and IANA publication remain out of scope (operational/legal). |

### 2.4 IPv6 (Specification 6, Section 1.5)

| Requirement | Status | Evidence / Notes |
| --- | --- | --- |
| Accept IPv6 addresses as glue records and publish them | Met (mock) | Host objects store IPv4/IPv6 addresses ([src/host/](../src/host)); RDAP nameserver objects publish `ipAddresses.v4/v6`, and the zone generator emits A/AAAA glue for in-bailiwick hosts ([src/dns/melendezZone.ts](../src/dns/melendezZone.ts)). |

## 3. Specification 4 - Registration Data Directory Services (RDDS)

| Requirement | Status | Evidence / Notes |
| --- | --- | --- |
| WHOIS over port 43 (RFC 3912) | Met | [src/whois/whoisServer.ts](../src/whois/whoisServer.ts), formatting in [src/whois/whoisFormatter.ts](../src/whois/whoisFormatter.ts). Returns domain, registrar, dates, statuses, nameservers, contacts, DNSSEC/DS. |
| Mandatory WHOIS disclaimer footer (limited-data notice pointing to https://lookup.icann.org) | Met | [src/whois/whoisFormatter.ts](../src/whois/whoisFormatter.ts) now appends the limited-data disclaimer and ICANN status-code notice to found and not-found responses. |
| RDAP Directory Services (STD95; RFCs 7480-7484, 9082, 9083, 9224; RDAP Technical Implementation Guide + RDAP Response Profile) | Met (core) | RDAP HTTP service ([src/rdap/rdapServer.ts](../src/rdap/rdapServer.ts), [src/rdap/rdapMapper.ts](../src/rdap/rdapMapper.ts)) serves `/domain`, `/nameserver`, `/entity`, `/help` with RFC 9083 JSON, `rdapConformance`, `application/rdap+json`, and RDAP error objects. Defaults to port 8090 (`RDAP_PORT`). |
| Web-based WHOIS (free, public, query-based) and optional searchability | Missing | The dashboard ([src/control/dashboardHtml.ts](../src/control/dashboardHtml.ts)) is an operator console, not an RFC-style public web-WHOIS lookup. |
| Rate limiting / access controls / data-element redaction policy | N/A (partial) | Not implemented; primarily a policy/operational concern, though redaction would matter for a faithful RDAP mock. |

## 4. Specification 10 - Performance Specifications (SLRs)

| Requirement | Status | Evidence / Notes |
| --- | --- | --- |
| DNS / EPP / RDAP availability and RTT SLRs measured by ICANN probes | N/A | The agreement's SLRs presuppose a globally-probed production service. A local mock has no probe network or uptime accounting. |
| EPP/WHOIS responsiveness (informational) | Met (informally) | Local EPP and WHOIS responses are well under the RTT targets (e.g. EPP transform <= 4000 ms), but availability/uptime is not measured or guaranteed. |

## 5. Out-of-scope provisions (legal / operational) - N/A

These sections cannot be satisfied by a mock testing tool and are out of scope. Each is marked
N/A with the reason.

| Provision | Reason it is N/A |
| --- | --- |
| Articles 1-7 (term, fees, covenants, representations, indemnification, insurance, audit, dispute resolution, termination, transition) | Contractual/financial/legal obligations of a real Registry Operator. |
| Specification 1 (Consensus & Temporary Policies) | Binds an operator to ICANN policy processes; not a technical feature. |
| Specification 2 (Data Escrow) | Requires a third-party Escrow Agent, OpenPGP/RFC 9580 deposits, daily schedules, ICANN as beneficiary. |
| Specification 3 (Monthly Reporting) | Per-registrar transaction + activity reports submitted to ICANN via their API. |
| Specification 5 (Reserved Names) | Partial (mock) | Technical labels (`nic`, `whois`, `rdap`, `www`, `rdds`, `registry`, `registrar`), all two-character SLDs, sample brand strings, and a representative English country-name set are blocked in [src/domain/registryPolicy.ts](../src/domain/registryPolicy.ts). A full ISO/country list and sunrise/claims integration remain out of scope. |
| Specification 7 (Rights Protection Mechanisms) | Trademark Clearinghouse, Sunrise, Claims, URS/UDRP - external programs. (The EPP side, RFC 8334, is tracked in section 2.1.) |
| Specification 9 (Registry Operator Code of Conduct) | Conduct/governance obligations. |
| Specification 11 (Public Interest Commitments) | Contractual public-interest commitments. |
| Specification 13 (.Brand TLD) | Applies only to qualifying .brand registries. |

## 6. Summary scorecard (technical scope only)

| Area | Status |
| --- | --- |
| EPP transport (5734) | Met |
| EPP core (5730) | Met (core) |
| Domain mapping (5731) | Met (core) |
| DNSSEC EPP (5910) | Met |
| Host objects (5732) | Met |
| Contact objects (5733) | Met |
| RGP (3915) | Met |
| Launch phase (8334) | Met (core) |
| DNSSEC (DNS side) | Partial |
| IDN | Met (mock) / Partial tables |
| IPv6 glue | Met (mock) |
| WHOIS port 43 (3912) | Met |
| WHOIS disclaimer footer | Met |
| RDAP (Spec 4) | Met (core) |
| Web WHOIS / searchability | Missing |
| Performance SLRs (Spec 10) | N/A |

## 7. Remediation backlog - status

The original prioritized backlog has been implemented in this pass:

1. **RDAP Directory Service (Specification 4).** Done - [src/rdap/rdapServer.ts](../src/rdap/rdapServer.ts),
   [src/rdap/rdapMapper.ts](../src/rdap/rdapMapper.ts) (`/domain`, `/nameserver`, `/entity`,
   `/help`, RFC 9083 JSON, `rdapConformance`, `application/rdap+json`, error objects).
2. **EPP contact (5733) and host (5732) objects.** Done - [src/contact/](../src/contact),
   [src/host/](../src/host), and the corresponding `contact:*` / `host:*` handlers, with
   IPv4/IPv6 glue and IP-family validation.
3. **RGP (3915) and launch phase (8334).** Done - redemption/restore flow in
   [src/domain/domainService.ts](../src/domain/domainService.ts); `launch` namespace handling in
   [src/epp/domainCommandHandler.ts](../src/epp/domainCommandHandler.ts).
4. **EPP core polish (5730).** Done - `clTRID` echo, login `<version>`/`<lang>`/`<svcs>`
   validation with 2100/2102/2307 codes, and the `<msgQ>` poll model.
5. **WHOIS disclaimer; IDN table; IPv6 glue.** Done - disclaimer footer in
   [src/whois/whoisFormatter.ts](../src/whois/whoisFormatter.ts); Latin IDN table in
   [src/domain/registryPolicy.ts](../src/domain/registryPolicy.ts); A/AAAA glue from host
   objects in [src/dns/melendezZone.ts](../src/dns/melendezZone.ts).

Remaining (intentionally deferred) technical items: full RDAP TIG/Response-Profile field-level
conformance, a complete pending-status state machine beyond client/server prohibitions, IDN variant
management, a live signed authoritative DNS server with key rollover, and a public web-WHOIS/RDAP
search UI. Persistence note: poll-message data uses an in-memory repository (domains, contacts, and
hosts support SQLite when `STORAGE_MODE=sqlite`).

## 8. Conclusion

As a **mock EPP testing tool**, the project now covers the EPP transport, login/session, the
domain object lifecycle, the secDNS/rgp/launch extensions, **contact and host objects**, port-43
**WHOIS with the limited-data disclaimer**, DNSSEC zone generation with IPv4/IPv6 glue, and an
**RDAP** directory service. Measured against the **technical** subset of the Base Registry
Agreement it is now **largely conformant for a mock context**; the remaining ~90% of the
agreement is legal/operational and is intentionally out of scope for a testing tool.
