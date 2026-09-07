# AWS EC2 Deployment

Production host: `eppmock.melendez.mx` on a single EC2 instance (Docker Compose + Caddy).

What is public:

- HTTPS dashboard and RDAP path through Caddy (`80`/`443`).
- **EPP TLS on TCP `700`** (IANA EPP). Node terminates TLS with the Let’s Encrypt cert Caddy already issued for `eppmock.melendez.mx`.
- WHOIS on TCP `43`.

What stays inside the container:

- Plaintext EPP on `127.0.0.1:7000` for the dashboard only (not published). Auto login uses this port so it does not need a client certificate.
- RDAP on `8090` (Caddy reverse-proxies `/rdap` and the optional `rdap.` subdomain).
- SQLite + DNSSEC keys on the `epp_data` Docker volume.

## How EPP is wired

ICANN RST talks to `epp.hostName` on **TCP 700 with TLS**. It must not go through Caddy on 443, CloudFront, or an ALB.

```text
RST / openssl  -->  :700  TLS  -->  Node (same CommandRouter as the dashboard)
Browser        -->  :443  HTTPS -->  Caddy --> :8080 dashboard
Dashboard EPP  -->  127.0.0.1:7000 plaintext (password login)
```

### 1. DNS

Keep the existing A record (required):

```text
eppmock.melendez.mx -> EC2 public IPv4
```

Use that same name as RST `epp.hostName`. Optionally add AAAA if the instance has IPv6:

```text
eppmock.melendez.mx AAAA -> EC2 public IPv6
```

Do not put EPP behind CloudFront or an ALB. The probe must reach the instance.

### 2. Security group

Inbound that should stay:

- `700/tcp` from your test IP, then `epp.clientACL` when ICANN publishes it — not `0.0.0.0/0` once RST IPs are known
- `80/tcp` and `443/tcp` from `0.0.0.0/0` (Caddy / Let's Encrypt HTTP-01)
- `22/tcp` from your IP only
- `43/tcp` as needed for WHOIS

Do not publish `7000`. Compose no longer maps it.

Do **not** open UDP/TCP **53** on this EPP host for `StandardEPP`. Authoritative DNS / DNSSEC
is a separate RST suite and needs two nameservers in different ASes; see `docs/RST_DNS.md`.

AWS console: EC2 → Security Groups → inbound rules. Example CLI (substitute IDs):

```bash
aws ec2 authorize-security-group-ingress --group-id sg-... --protocol tcp --port 700 --cidr <rst-or-your-ip>/32
aws ec2 revoke-security-group-ingress --group-id sg-... --protocol tcp --port 7000 --cidr 0.0.0.0/0
```

### 3. TLS certificate

No extra Let's Encrypt setup. Caddy already has a public certificate for `eppmock.melendez.mx`. On container start the app copies that cert/key from the `caddy_data` volume and listens with TLS 1.2+ on port 700.

After deploy, confirm:

```bash
echo | openssl s_client -connect eppmock.melendez.mx:700 -servername eppmock.melendez.mx 2>/dev/null | openssl x509 -noout -subject -dates -ext subjectAltName
```

The SAN must include `eppmock.melendez.mx`. TLS 1.1 must fail:

```bash
openssl s_client -connect eppmock.melendez.mx:700 -tls1_1
```

### 4. RST registrar certificates (epp-03)

ICANN gives you `epp.client01Certificate` / `epp.client02Certificate` (or CSRs). Put each SHA-256 fingerprint on `melendez-registrar` and `melendez-tester` in the GitHub `EPP_USERS` secret (those are `epp.clid01` / `epp.clid02`):

```bash
chmod +x deploy/fingerprint-cert.sh
./deploy/fingerprint-cert.sh client01.pem
```

Example `EPP_USERS` secret:

```json
[
  {"clid":"melendez-admin","password":"..."},
  {"clid":"melendez-registrar","password":"...","clientCertSha256":"ab12..."},
  {"clid":"melendez-tester","password":"...","clientCertSha256":"cd34..."}
]
```

Seed `epp.registeredNames` with a domain **not** sponsored by those two clients (create it as `melendez-admin` from the dashboard).

Smoke-test TLS login before ICANN issues certs with a throwaway client cert:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/registrar.key -out /tmp/registrar.pem -days 30 -subj "/CN=melendez-registrar"
./deploy/fingerprint-cert.sh /tmp/registrar.pem
```

Put that fingerprint on `melendez-registrar` in `EPP_USERS`, redeploy, then:

```bash
openssl s_client -connect eppmock.melendez.mx:700 -servername eppmock.melendez.mx -cert /tmp/registrar.pem -key /tmp/registrar.key
```

### 5. Deploy

Push or merge to `main` (or **Actions → Deploy to AWS EC2 → Run workflow**). Compose publishes `700` and waits for the Caddy certificate before Node listens.

```bash
docker compose -f deploy/docker-compose.aws.yml logs -f app
```

You should see `Exported Caddy certificate for eppmock.melendez.mx` and `listening on 0.0.0.0:700 (TLS)`, plus `EPP dashboard (localhost) listening on 127.0.0.1:7000 (TCP)`.

## AWS Resources

Recommended low-cost setup:

- EC2: `t4g.micro` or `t3.micro`
- OS: Ubuntu 24.04 LTS
- Storage: 20 GB gp3 EBS
- Public IPv4 or Elastic IP

Security group inbound rules:

- `22/tcp` from your IP only
- `80/tcp` from `0.0.0.0/0`
- `443/tcp` from `0.0.0.0/0`
- `43/tcp` from `0.0.0.0/0` or from the IP ranges that need WHOIS access
- `700/tcp` from `epp.clientACL` (RST probes) or your test IP — **not** from the whole internet once RST IPs are known

Do not publish `7000`. The dashboard talks to EPP on `127.0.0.1:7000` inside the container.

RDAP does not need its own inbound port: it is served over `443/tcp` via Caddy on
`${CONTROL_BASE_URL}/rdap` (recommended) or on the optional `rdap.eppmock.melendez.mx` subdomain.

Avoid NAT Gateway, RDS, and Load Balancers for the lowest-cost deployment.

## DNS

Create an `A` record for the dashboard host:

```text
eppmock.melendez.mx -> EC2 public IPv4
```

RDAP is available at `https://eppmock.melendez.mx/rdap` once Caddy is running. Optionally,
add a second record if you prefer a dedicated RDAP subdomain:

```text
rdap.eppmock.melendez.mx -> EC2 public IPv4
```

Caddy will automatically request and renew TLS certificates for
`eppmock.melendez.mx` (dashboard + RDAP path) and, if configured,
`rdap.eppmock.melendez.mx`.

## Install EC2 Dependencies

SSH into the EC2 instance and install Docker:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and log back in so the Docker group applies.

## GitHub Secrets

Add these repository secrets in GitHub:

```text
AWS_EC2_HOST=<ec2-public-ip-or-dns>
AWS_EC2_USER=ubuntu
AWS_EC2_SSH_KEY=<private-ssh-key-for-ec2>
AWS_EC2_SSH_PORT=22
RESET_HTTP_USER=admin
RESET_HTTP_PASSWORD=<strong-password>
EPP_USERS=[{"clid":"melendez-admin","password":"..."}]
DNSSEC_KEY_PATH=/app/data/dnssec-keys.json
REGISTRY_TLD=melendez
WHOIS_HOST=0.0.0.0
WHOIS_PORT=43
```

`RESET_HTTP_PASSWORD` and `EPP_USERS` are required in production. The container runs with
`NODE_ENV=production`, and startup fails if the reset password is still a default value or if
`EPP_USERS` is omitted.

`DNSSEC_KEY_PATH` should point inside `/app/data` so KSK/ZSK material survives container rebuilds.

## Deployment

The workflow `.github/workflows/deploy-aws-ec2.yml` runs on every push to `main`.

It will:

1. Run `npm ci`.
2. Build the TypeScript project.
3. SSH into EC2.
4. Clone or update `/opt/epp-testing-tool`.
5. Write `deploy/.env` from GitHub secrets.
6. Run:

```bash
docker compose -f deploy/docker-compose.aws.yml up -d --build
```

## Persistence, Backups, and Rollback

SQLite registry data and DNSSEC key material live in the `epp_data` Docker volume:

```text
/app/data/epp-testing-tool.sqlite
/app/data/dnssec-keys.json
```

Create a backup before deployments or key renewals:

```bash
docker run --rm -v epp-testing-tool_epp_data:/data -v "$PWD":/backup alpine \
  sh -c 'cd /data && tar czf /backup/epp-data-$(date +%Y%m%d%H%M%S).tgz .'
```

Restore a backup only after stopping the app:

```bash
docker compose -f deploy/docker-compose.aws.yml down
docker run --rm -v epp-testing-tool_epp_data:/data -v "$PWD":/backup alpine \
  sh -c 'cd /data && rm -rf ./* && tar xzf /backup/epp-data-YYYYMMDDHHMMSS.tgz'
docker compose -f deploy/docker-compose.aws.yml up -d --build
```

Rollback to a previous Git revision:

```bash
cd /opt/epp-testing-tool
git fetch origin
git checkout <previous-commit-sha>
docker compose -f deploy/docker-compose.aws.yml up -d --build
```

Do not delete `dnssec-keys.json` unless you intentionally want to publish a new DNSSEC key set.
Deleting it changes the generated DNSKEY and parent DS values.

## DNSSEC Operations

The zone generator signs the `.melendez` zone with persisted ECDSA P-256 KSK/ZSK material. It
emits DNSKEY, DS, RRSIG, NSEC3, and NSEC3PARAM records when DNSSEC is enabled. It does **not**
answer on port 53. For RST Authoritative DNS / DNSSEC, load that file on two public nameservers
in different ASes (`docs/RST_DNS.md`).

Use NSEC3 iterations **0** and empty salt (`-`) so `dnssec-93` passes. Use `Generate keys` for
normal operation. It reuses existing keys from `DNSSEC_KEY_PATH`. Use `Renew keys` only when you
intentionally want to rotate the ZSK and refresh the persisted key metadata. Back up the
`epp_data` volume before renewal. After a key change you must republish `dnssec.dsRecords`.

## Public URLs

Dashboard:

```text
https://eppmock.melendez.mx
```

EPP TCP (TLS, RST `epp.hostName`):

```text
eppmock.melendez.mx:700
```

WHOIS TCP:

```text
eppmock.melendez.mx:43
```

RDAP:

```text
https://rdap.eppmock.melendez.mx
```

## Manual Deploy

If needed, deploy manually on EC2:

```bash
sudo mkdir -p /opt/epp-testing-tool
sudo chown "$USER":"$USER" /opt/epp-testing-tool
git clone https://github.com/mikemelendez/eppmock.git /opt/epp-testing-tool
cd /opt/epp-testing-tool
cp deploy/.env.example deploy/.env
docker compose -f deploy/docker-compose.aws.yml up -d --build
```
