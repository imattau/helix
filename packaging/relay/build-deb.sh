#!/usr/bin/env bash
# Assembles the .deb release artifact (expects `npm run build:relay` to have already
# produced dist/helix-relay.cjs). Only archives files - does not install anything on
# this host; installing the resulting .deb (dpkg -i / apt install) is a separate step.
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

if ! command -v dpkg-deb >/dev/null 2>&1; then
  echo "dpkg-deb not found - install dpkg-dev (or run on a Debian/Ubuntu host)" >&2
  exit 1
fi

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT
PKG_ROOT="$STAGE_DIR/pkg"

mkdir -p "$PKG_ROOT/DEBIAN" \
         "$PKG_ROOT/opt/helix-relay" \
         "$PKG_ROOT/etc/helix-relay" \
         "$PKG_ROOT/lib/systemd/system"

cp "$BUNDLE" "$PKG_ROOT/opt/helix-relay/helix-relay.cjs"
chmod 755 "$PKG_ROOT/opt/helix-relay/helix-relay.cjs"
# Shipped as the package's default config (and listed in DEBIAN/conffiles below) -
# dpkg preserves local edits to it across upgrades, only /var/lib/helix-relay (the
# runtime data dir, created by postinst, never shipped in the package itself) holds
# state that must never be touched by a reinstall.
cp "$PACKAGING_DIR/helix-relay.env.example" "$PKG_ROOT/etc/helix-relay/helix-relay.env"
chmod 640 "$PKG_ROOT/etc/helix-relay/helix-relay.env"
cp "$PACKAGING_DIR/helix-relay.service" "$PKG_ROOT/lib/systemd/system/helix-relay.service"

sed "s/__VERSION__/$VERSION/" "$PACKAGING_DIR/debian/control" > "$PKG_ROOT/DEBIAN/control"
cp "$PACKAGING_DIR/debian/conffiles" "$PKG_ROOT/DEBIAN/conffiles"
install -m 755 "$PACKAGING_DIR/debian/postinst" "$PKG_ROOT/DEBIAN/postinst"
install -m 755 "$PACKAGING_DIR/debian/prerm" "$PKG_ROOT/DEBIAN/prerm"
install -m 755 "$PACKAGING_DIR/debian/postrm" "$PKG_ROOT/DEBIAN/postrm"

mkdir -p "$OUT_DIR"
DEB_PATH="$OUT_DIR/helix-relay_${VERSION}_all.deb"
dpkg-deb --build --root-owner-group "$PKG_ROOT" "$DEB_PATH"
echo "Built $DEB_PATH"
