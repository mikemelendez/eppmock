#!/bin/sh
set -eu

if [ -n "${EPP_TLS_CERT:-}" ]; then
  i=0
  while [ "$i" -lt 60 ]; do
    if node /app/export-caddy-certs.mjs; then
      echo "Exported Caddy certificate for ${EPP_HOSTNAME:-eppmock.melendez.mx} to ${EPP_TLS_CERT}"
      break
    fi
    i=$((i + 1))
    echo "Waiting for Caddy certificate for ${EPP_HOSTNAME:-eppmock.melendez.mx} (${i}/60)..."
    sleep 2
  done

  if [ ! -s "${EPP_TLS_CERT}" ]; then
    echo "No TLS certificate at ${EPP_TLS_CERT}." >&2
    echo "Confirm Caddy has issued a cert for ${EPP_HOSTNAME:-eppmock.melendez.mx} (HTTPS dashboard must already work)." >&2
    if [ "${NODE_ENV:-}" = "production" ]; then
      exit 1
    fi
  fi
fi

exec "$@"
