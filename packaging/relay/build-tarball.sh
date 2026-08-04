#!/usr/bin/env bash
# Assembles the tarball release artifact: the bundled relay CLI (expects
# `npm run build:relay` to have already produced dist/helix-relay.cjs) plus the
# systemd unit, config template, and installer, from this directory.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACKAGING_DIR="$ROOT_DIR/packaging/relay"
BUNDLE="$ROOT_DIR/dist/helix-relay.cjs"
OUT_DIR="${1:-$ROOT_DIR/dist}"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"

if [[ ! -f "$BUNDLE" ]]; then
  echo "missing $BUNDLE - run 'npm run build:relay' first" >&2
  exit 1
fi

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT
PKG_DIR="$STAGE_DIR/helix-relay-$VERSION"
mkdir -p "$PKG_DIR"

cp "$BUNDLE" "$PKG_DIR/helix-relay.cjs"
cp "$PACKAGING_DIR/helix-relay.service" "$PKG_DIR/"
cp "$PACKAGING_DIR/helix-relay.env.example" "$PKG_DIR/"
cp "$PACKAGING_DIR/install.sh" "$PKG_DIR/"
chmod 755 "$PKG_DIR/install.sh"

mkdir -p "$OUT_DIR"
TARBALL="$OUT_DIR/helix-relay-$VERSION-linux.tar.gz"
tar -C "$STAGE_DIR" -czf "$TARBALL" "helix-relay-$VERSION"
echo "Built $TARBALL"
