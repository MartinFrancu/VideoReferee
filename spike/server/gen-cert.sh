#!/usr/bin/env bash
# Generates a throwaway self-signed TLS cert so phones on the local network
# can reach this server over https:// — required for getUserMedia()/Wake
# Lock to work on anything other than localhost.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -nodes -subj "/CN=videoreferee-spike"
echo "Wrote certs/key.pem and certs/cert.pem"
