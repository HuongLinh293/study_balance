#!/bin/sh
# One-shot: create a self-signed certificate for the local gateway if none exists.
# To use a trusted one instead (e.g. from mkcert), put tls.crt and tls.key in
# infrastructure/nginx/certs/ before starting; this script leaves them alone.
set -eu
DIR=/certs
if [ -s "$DIR/tls.crt" ] && [ -s "$DIR/tls.key" ]; then
  echo '{"service":"gateway-cert","event":"certificate_present"}'
  exit 0
fi
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
  -subj "/CN=StudyBalance local gateway" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1" \
  -addext "extendedKeyUsage=serverAuth" \
  -keyout "$DIR/tls.key.tmp" -out "$DIR/tls.crt.tmp" 2>/dev/null
chmod 600 "$DIR/tls.key.tmp"
mv "$DIR/tls.key.tmp" "$DIR/tls.key"
mv "$DIR/tls.crt.tmp" "$DIR/tls.crt"
echo "{\"service\":\"gateway-cert\",\"event\":\"certificate_created\",\"sha256\":\"$(openssl x509 -in "$DIR/tls.crt" -noout -fingerprint -sha256 | cut -d= -f2)\"}"
