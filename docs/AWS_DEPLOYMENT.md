# AWS EC2 Deployment

This project deploys well on a small AWS EC2 instance because it exposes:

- HTTP/HTTPS dashboard through Caddy.
- Raw EPP TCP on port `7000`.
- SQLite persistence on an attached EBS volume through a Docker volume.

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
- `7000/tcp` from the IP ranges that need EPP access

Avoid NAT Gateway, RDS, and Load Balancers for the lowest-cost deployment.

## DNS

Create an `A` record:

```text
eppmock.melendez.mx -> EC2 public IPv4
```

Caddy will automatically request and renew TLS certificates for `eppmock.melendez.mx`.

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
```

`EPP_USERS` is optional. If omitted, the app uses the default testing users.

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

## Public URLs

Dashboard:

```text
https://eppmock.melendez.mx
```

EPP TCP:

```text
eppmock.melendez.mx:7000
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
