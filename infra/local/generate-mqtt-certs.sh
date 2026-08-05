#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cert_dir="$script_dir/certs"

rm -rf "$cert_dir"
mkdir -p "$cert_dir"
umask 077

openssl genrsa -out "$cert_dir/ca.key" 4096
openssl req -x509 -new -key "$cert_dir/ca.key" -sha256 -days 3650 \
  -out "$cert_dir/ca.crt" -subj '/CN=smart-house-local-ca'

make_certificate() {
  local name="$1"
  local common_name="$2"
  local extensions="$3"
  local escaped_common_name="${common_name//\//\\/}"

  openssl genrsa -out "$cert_dir/$name.key" 2048
  openssl req -new -key "$cert_dir/$name.key" -out "$cert_dir/$name.csr" \
    -subj "/CN=$escaped_common_name"
  openssl x509 -req -in "$cert_dir/$name.csr" -CA "$cert_dir/ca.crt" \
    -CAkey "$cert_dir/ca.key" -CAcreateserial -out "$cert_dir/$name.crt" \
    -days 825 -sha256 -extfile <(printf '%s\n' "$extensions")
  rm "$cert_dir/$name.csr"
}

make_certificate server localhost $'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth'
make_certificate device-temp-001 tenants/demo/devices/temp-001 'extendedKeyUsage=clientAuth'
make_certificate device-relay-001 tenants/demo/devices/relay-001 'extendedKeyUsage=clientAuth'
make_certificate device-other-001 tenants/demo/devices/other-001 'extendedKeyUsage=clientAuth'
make_certificate platform-worker platform-worker 'extendedKeyUsage=clientAuth'

# The official Mosquitto image drops privileges before reading its server
# material. Client keys and the CA private key remain owner-only.
chmod 755 "$cert_dir"
chmod 644 "$cert_dir/ca.crt" "$cert_dir/server.crt" "$cert_dir/server.key"

printf 'Generated local MQTT certificates in %s\n' "$cert_dir"
