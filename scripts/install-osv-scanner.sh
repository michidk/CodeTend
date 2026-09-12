#!/usr/bin/env bash
# Installs the osv-scanner release that the Dockerfile pins into .tools/ for
# local Eve runs, verifying the published checksum. Docker images already
# include it; this is only for `bun run dev` / the local preview.
set -euo pipefail
cd "$(dirname "$0")/.."

version="${OSV_SCANNER_VERSION:-$(sed -n 's/^ARG OSV_SCANNER_VERSION=//p' Dockerfile)}"
arch="$(uname -m)"
case "$arch" in
  x86_64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
esac
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
asset="osv-scanner_${os}_${arch}"
base="https://github.com/google/osv-scanner/releases/download/${version}"

mkdir -p .tools
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl --connect-timeout 15 --max-time 120 --retry 3 -fsSL -o "$tmp/$asset" "$base/$asset"
curl --connect-timeout 15 --max-time 120 --retry 3 -fsSL -o "$tmp/SHA256SUMS" "$base/osv-scanner_SHA256SUMS"
(cd "$tmp" && grep " ${asset}$" SHA256SUMS | sha256sum -c -)
install -m 0755 "$tmp/$asset" .tools/osv-scanner
echo "installed osv-scanner ${version} at .tools/osv-scanner"
