# ICANN RST v2026.06 — Authoritative DNS / DNSSEC

Reference: [RST Test Specifications v2026.06](https://icann.github.io/rst-test-specs/v2026.06/rst-test-specs.html)
(`Authoritative DNS Service` and `DNS Security Extensions (DNSSEC)`).

This is **not** `StandardEPP`. EPP tests resolve `epp.hostName` through ordinary public DNS
(ClouDNS already answers `eppmock.melendez.mx`). The DNS suites query **your TLD nameservers**
on UDP and TCP **53**, using the hosts you list in `dns.nameservers`.

## What this repo does today

The dashboard and `GET /dns/zone` generate a BIND-style zone for `.melendez` (NS, glue, DS,
DNSKEY, RRSIG, NSEC3). That file is **not** served on port 53. There is no Knot/BIND/PowerDNS
process in `deploy/docker-compose.aws.yml`.

ClouDNS (`ns1/2/3.cloudns.net`) hosts **`melendez.mx`**, a second-level name under `.mx`.
That is a different zone from the fictional TLD **`.melendez`**. Do not list ClouDNS as the
TLD nameservers unless those servers actually load the `.melendez` apex zone.

The generated apex glue is documentation space until you replace it:

```text
ns1.melendez.  A  192.0.2.10
ns2.melendez.  A  192.0.2.11
```

Zonemaster treats those as `ZM_A01_DOCUMENTATION_ADDR` (**CRITICAL**). They cannot pass RST.

## What RST will probe

Zonemaster talks **directly** to the IPs in `dns.nameservers`. The TLD does not need to be
in the IANA root.

| Check | Requirement |
| --- | --- |
| `dns-delegation01/02` | At least **two** NS names, **distinct** IPv4 (and IPv6) addresses |
| `dns-connectivity01/02` | SOA/NS over **UDP 53** and **TCP 53**, **AA** bit set |
| `dns-connectivity03` | Those IPs announced from **different ASNs**, for IPv4 **and** IPv6 (`ZM_IPV4_ONE_ASN` / `ZM_IPV6_ONE_ASN` are ERROR) |
| `dns-address01` | Globally reachable unicast; no RFC 1918 / documentation / loopback |
| `dns-nameserver01` | Authoritative **only** (recursion off) |
| `dns-nameserver02` + EDNS cases | EDNS(0), unknown version/options/flags handled correctly |
| `dns-consistency*` | Same SOA/NS/glue on every listed nameserver |
| `dns-nameserver05` | AAAA queries must not drop or return a bad RCODE |

DNSSEC suite extra inputs: `dnssec.dsRecords` (at least one DS per TLD).

| Check | Requirement |
| --- | --- |
| `dnssec-02` | Submitted DS matches a **SEP** DNSKEY in the child and validates |
| `dnssec-91` | Zone-signing algorithm **MAY** or **RECOMMENDED** (this signer uses **13** ECDSAP256SHA256) |
| `dnssec-92` | DS digest **2** (SHA-256) |
| `dnssec-93` | NSEC3 **iterations = 0**, salt **empty** (`-` in presentation format) |

Dashboard / API defaults are those RFC 9276 values (`iterations=0`, `salt=-`). Do not raise
iterations or add a salt for RST.

`dnssecOps-*` (KSK/ZSK rollover with 10k delegations and a chain to the root) is a **separate**
suite. This document covers only Authoritative DNS + DNSSEC.

## Why one EC2 is not enough

`eppmock.melendez.mx` is a single AWS host. Two listeners on that box still share **AS 16509**.
IPv6 is also missing today (no public AAAA). Either gap fails the DNS suite.

You need two **public** nameservers:

1. **Different ASes** (for example AWS + Hetzner/DigitalOcean/Linode/GCP — not two AWS regions).
2. **IPv4 and IPv6** on each (or at least two distinct v4 and two distinct v6 across the set).
3. Same signed zone on both (hidden primary + AXFR, or copy the same file).

Keep EPP on TCP **700** on the existing instance. Do not put EPP behind the DNS stack.

## Recommended topology

```text
                    ┌─────────────────────────────────┐
  dashboard / EPP   │  eppmock.melendez.mx (EC2)      │
  generates zone    │  GET /dns/zone?dnssec=true      │
                    │  optional hidden Knot :5353     │  AXFR (TSIG)
                    └──────────────┬──────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                                         ▼
   ns1.melendez. (AS A)                      ns2.melendez. (AS B)
   UDP/TCP 53  IPv4+IPv6                     UDP/TCP 53  IPv4+IPv6
   authoritative, recursion no               same zone, recursion no
```

`dns.nameservers` lists **ns1** and **ns2** (the public secondaries), not the hidden primary
and not `eppmock.melendez.mx`.

### Security groups / firewall

On each public NS:

- Allow **53/udp** and **53/tcp** from the Internet (RST probes from many places).
- Do **not** open 53 on the EPP host unless that host is itself one of the listed NS.
- Leave EPP **700** as it is; do not proxy it.

### IPv6

Enable IPv6 on the VPC/subnet/ENI (or the second VPS), assign a global address, then publish
AAAA for `ns1`/`ns2`. Do not invent an AAAA.

PTR (`dns-address02/03`) is WARNING in this RST edition, so missing reverse DNS will not fail
the suite. Still worth setting if the provider allows it.

## Load the zone this tool already signs

1. Generate with RST NSEC3 parameters (the dashboard defaults):

   ```bash
   curl -fsS 'https://eppmock.melendez.mx/dns/zone?dnssec=true&keyAction=generate&nsec3Hash=1&nsec3Flags=0&nsec3Iterations=0&nsec3Salt=-' \
     -o melendez.zone
   ```

2. Replace apex documentation glue with the **real** NS addresses (A and AAAA). Keep
   `ns1.melendez.` / `ns2.melendez.` as the NS names unless you change both the zone and
   `dns.nameservers`.

3. Load that file as the apex zone `melendez.` on both public nameservers. Recursion **off**.
   Serve TCP as well as UDP.

4. Copy the apex **DS** (the `@ IN DS …` line, not child-domain DS) into `dnssec.dsRecords`.
   Algorithm **13**, digest type **2**, key tag from that line. Keep using `keyAction=generate`
   (or leave keys on the `epp_data` volume) so the DS still matches the live DNSKEY.

Example Knot secondary (`knot.conf` fragment):

```text
server:
  listen: 0.0.0.0@53
  listen: ::@53

zone:
  - domain: melendez.
    file: /var/lib/knot/melendez.zone
    dnssec-signing: off
```

`dnssec-signing: off` because this repo already signed the file. If Knot re-signs, the DS
you submit to RST will not match.

Example Docker one-shot check (not a production NS):

```bash
docker run --rm -p 5353:53/udp -p 5353:53/tcp \
  -v "$PWD/melendez.zone:/var/lib/knot/melendez.zone:ro" \
  cznic/knot:latest
dig +norecurse SOA melendez. @127.0.0.1 -p 5353
# Expect AA, two NS, no RA.
```

## RST form values

```json
{
  "dns.nameservers": [
    {
      "name": "melendez",
      "nameservers": [
        {
          "name": "ns1.melendez",
          "v4Addrs": ["<ns1-public-ipv4>"],
          "v6Addrs": ["<ns1-public-ipv6>"]
        },
        {
          "name": "ns2.melendez",
          "v4Addrs": ["<ns2-public-ipv4>"],
          "v6Addrs": ["<ns2-public-ipv6>"]
        }
      ]
    }
  ],
  "dnssec.dsRecords": [
    {
      "name": "melendez",
      "dsRecords": [
        {
          "keyTag": 0,
          "alg": 13,
          "digestType": 2,
          "digest": "<hex from the apex DS in the zone file>"
        }
      ]
    }
  ]
}
```

Replace `keyTag` / `digest` from the generated `@ IN DS` line. `supportsDoT` / `supportsDoH`
stay false unless you actually offer those transports (`Additional DNS Transports` is another
suite).

## Local checks before RST

From a host that is **not** the nameserver:

```bash
# UDP + TCP, AA, matching NS set
dig +norecurse +aaflag SOA melendez. @<ns1-ipv4>
dig +norecurse +tcp NS melendez. @<ns2-ipv4>
dig +norecurse AAAA ns1.melendez. @<ns1-ipv6>

# Must not recurse
dig +recurse NS google.com @<ns1-ipv4>   # REFUSED or no answers with RA=0

# DNSSEC
dig +dnssec DNSKEY melendez. @<ns1-ipv4>
dig +dnssec NSEC3PARAM melendez. @<ns1-ipv4>
# NSEC3PARAM should look like: 1 0 0 -
```

[Zonemaster-CLI](https://github.com/zonemaster/zonemaster) against the same IPs is the closest
preview of the RST DNS cases.

## Out of scope here

- Opening port 53 on the current EPP EC2 **instead of** a second AS.
- Using `192.0.2.0/24` or `2001:db8::/32` in `dns.nameservers`.
- Re-signing on the nameserver while RST still holds the old DS.
- DNSSEC Operations rollover tests (`dnssecOps.*`).
