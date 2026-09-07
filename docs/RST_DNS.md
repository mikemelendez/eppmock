# ICANN RST v2026.06 — Authoritative DNS / DNSSEC

Reference: [RST Test Specifications v2026.06](https://icann.github.io/rst-test-specs/v2026.06/rst-test-specs.html)
(`Authoritative DNS Service` and `DNS Security Extensions (DNSSEC)`).

This is **not** `StandardEPP`. EPP tests resolve `epp.hostName` through ordinary public DNS
(ClouDNS already answers `eppmock.melendez.mx`). The DNS suites query **your TLD nameservers**
on UDP and TCP **53**, using the hosts you list in `dns.nameservers`.

## This repo vs a separate DNS project

**eppmock stays an EPP/RDAP/WHOIS mock.** It generates a signed BIND zone (`GET /dns/zone` and
the dashboard). It does not listen on port 53 and will not grow a Knot/BIND service.

Stand up Authoritative DNS in a **different repository and different hosts**. That project
pulls the zone from eppmock, replaces documentation glue, and serves `melendez.` on two
public nameservers.

ClouDNS (`ns1/2/3.cloudns.net`) hosts **`melendez.mx`**, a second-level name under `.mx`.
That is not the TLD zone **`.melendez`**. Do not list ClouDNS in `dns.nameservers` unless
those servers actually load the `.melendez` apex.

The generated apex glue is documentation space until the DNS project replaces it:

```text
ns1.melendez.  A  192.0.2.10
ns2.melendez.  A  192.0.2.11
```

Zonemaster treats those as `ZM_A01_DOCUMENTATION_ADDR` (**CRITICAL**).

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
| `dnssec-91` | Zone-signing algorithm **MAY** or **RECOMMENDED** (eppmock signs with **13** ECDSAP256SHA256) |
| `dnssec-92` | DS digest **2** (SHA-256) |
| `dnssec-93` | NSEC3 **iterations = 0**, salt **empty** (`-` in presentation format) |

eppmock dashboard / API defaults are those RFC 9276 values (`iterations=0`, `salt=-`). Do not
raise iterations or add a salt for RST. Do not let the nameserver **re-sign** the zone: the DS
submitted to RST would stop matching.

`dnssecOps-*` (KSK/ZSK rollover with 10k delegations and a chain to the root) is a **separate**
suite.

## Topology (other project, other machines)

One EC2 cannot pass the suite: two listeners on `eppmock.melendez.mx` still share **AS 16509**,
and there is no public AAAA today.

```text
  eppmock.melendez.mx          separate DNS repo
  GET /dns/zone (signed)  -->  fetch + rewrite glue
                               │
              ┌────────────────┼────────────────┐
              ▼                                 ▼
   ns1.melendez. (AS A)              ns2.melendez. (AS B)
   UDP/TCP 53  IPv4+IPv6             UDP/TCP 53  IPv4+IPv6
   Knot/BIND, recursion no           same zone, recursion no
```

`dns.nameservers` lists **ns1** and **ns2**, not `eppmock.melendez.mx`. Keep EPP on TCP **700**
on the existing instance. Do not open 53 on the EPP host unless that host is one of the listed
NS.

Each public NS: **53/udp** and **53/tcp** from the Internet. Enable real IPv6; do not invent
AAAA. PTR is WARNING in this RST edition (will not fail the suite).

Suggested second ASN: Hetzner, DigitalOcean, Linode, or GCP — **not** a second AWS region.

## New repo starter

Create a new GitHub repo (for example `melendez-ns`). Do not add these files to eppmock.
Deploy the **same** compose on two VPS in different ASes. Set `NS_ROLE=ns1` or `ns2` and the
four public addresses.

Zone URL (RST NSEC3 parameters; eppmock dashboard defaults match):

```text
https://eppmock.melendez.mx/dns/zone?dnssec=true&keyAction=generate&nsec3Hash=1&nsec3Flags=0&nsec3Iterations=0&nsec3Salt=-
```

### `docker-compose.yml`

```yaml
services:
  knot:
    image: cznic/knot:latest
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./knot.conf:/etc/knot/knot.conf:ro
      - ./zones:/var/lib/knot
    cap_add:
      - NET_BIND_SERVICE

  zone-sync:
    image: alpine:3.20
    restart: unless-stopped
    depends_on:
      - knot
    env_file: .env
    volumes:
      - ./zones:/zones
      - ./scripts:/scripts:ro
    command: ["sh", "/scripts/sync-zone.sh"]
```

`network_mode: host` so Knot binds 53 on the VPS. Do not publish 53 through Docker userland
proxy if you can avoid it.

### `.env`

```text
ZONE_URL=https://eppmock.melendez.mx/dns/zone?dnssec=true&keyAction=generate&nsec3Hash=1&nsec3Flags=0&nsec3Iterations=0&nsec3Salt=-
NS1_NAME=ns1.melendez.
NS2_NAME=ns2.melendez.
NS1_IPV4=
NS1_IPV6=
NS2_IPV4=
NS2_IPV6=
SYNC_SECONDS=60
```

### `knot.conf`

```text
server:
  listen: 0.0.0.0@53
  listen: ::@53
  rundir: /run/knot
  user: knot:knot

log:
  - target: stdout
    any: info

template:
  - id: default
    storage: /var/lib/knot
    dnssec-signing: off

zone:
  - domain: melendez.
    file: melendez.zone
    dnssec-signing: off
```

`dnssec-signing: off` is required: eppmock already signed the file.

### `scripts/sync-zone.sh`

```sh
#!/bin/sh
set -eu
apk add --no-cache curl bind-tools >/dev/null
: "${ZONE_URL:?}" "${NS1_IPV4:?}" "${NS2_IPV4:?}" "${NS1_IPV6:?}" "${NS2_IPV6:?}"
OUT=/zones/melendez.zone
while true; do
  tmp=$(mktemp)
  curl -fsS "$ZONE_URL" -o "$tmp"
  # Replace documentation glue (192.0.2.10/11) with the public NS addresses.
  awk -v ns1a="$NS1_IPV4" -v ns2a="$NS2_IPV4" -v ns1aaaa="$NS1_IPV6" -v ns2aaaa="$NS2_IPV6" '
    $0 ~ /^ns1[[:space:]]+IN[[:space:]]+A[[:space:]]+192\.0\.2\.10/ { print "ns1 IN A " ns1a; print "ns1 IN AAAA " ns1aaaa; next }
    $0 ~ /^ns2[[:space:]]+IN[[:space:]]+A[[:space:]]+192\.0\.2\.11/ { print "ns2 IN A " ns2a; print "ns2 IN AAAA " ns2aaaa; next }
    { print }
  ' "$tmp" > "$OUT"
  rm -f "$tmp"
  knotc reload >/dev/null 2>&1 || true
  sleep "${SYNC_SECONDS:-60}"
done
```

`knotc reload` only works if that container shares Knot’s control socket; a simpler first
version is: write the zone, then `docker kill -s HUP knot` or restart Knot after each fetch.
On two hosts, run the **same** rewritten file so SOA/NS stay identical (`dns-consistency*`).

### Firewall

```text
53/udp  0.0.0.0/0  ::/0
53/tcp  0.0.0.0/0  ::/0
```

Nothing else needs to be public. Do not enable recursion, forwarding, or a resolver stub.

## RST form values

Pull `keyTag` / `digest` from the apex `@ IN DS` line **after** glue rewrite (DS is independent
of A/AAAA). Keep using `keyAction=generate` on eppmock so keys stay on the `epp_data` volume.

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

`supportsDoT` / `supportsDoH` stay false unless that other project actually offers those
transports (`Additional DNS Transports` is another suite).

## Local checks before RST

From a host that is **not** the nameserver:

```bash
dig +norecurse SOA melendez. @<ns1-ipv4>
dig +norecurse +tcp NS melendez. @<ns2-ipv4>
dig +norecurse AAAA ns1.melendez. @<ns1-ipv6>
dig +recurse NS google.com @<ns1-ipv4>   # REFUSED or no answers with RA=0
dig +dnssec DNSKEY melendez. @<ns1-ipv4>
dig +dnssec NSEC3PARAM melendez. @<ns1-ipv4>
# NSEC3PARAM should look like: 1 0 0 -
```

[Zonemaster-CLI](https://github.com/zonemaster/zonemaster) against the same IPs is the closest
preview of the RST DNS cases.

## Out of scope for eppmock

- Knot, BIND, PowerDNS, or port 53 in this repository
- Opening port 53 on the EPP EC2 **instead of** a second AS
- Using `192.0.2.0/24` or `2001:db8::/32` in `dns.nameservers`
- Re-signing on the nameserver while RST still holds the old DS
- DNSSEC Operations rollover tests (`dnssecOps.*`)
