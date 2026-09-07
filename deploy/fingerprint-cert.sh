#!/bin/sh
# Print the SHA-256 fingerprint of a PEM certificate, lowercase and without colons.
# Usage: ./deploy/fingerprint-cert.sh client.pem
set -eu
openssl x509 -in "$1" -outform der | openssl dgst -sha256 -r | awk '{print $1}'
