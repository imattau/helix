#!/usr/bin/env bash
# Installs helix-relay as a systemd service. Run from an extracted release tarball
# (this script expects helix-relay.cjs, helix-relay.service, and
# helix-relay.env.example alongside it) as root: sudo ./install.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR=/opt/helix-relay
CONFIG_DIR=/etc/helix-relay
DATA_DIR=/var/lib/helix-relay
SERVICE_USER=helix-relay
UNIT_PATH=/etc/systemd/system/helix-relay.service

if [[ "$(id -u)" -ne 0 ]]; then
  echo "install.sh must be run as root (e.g. sudo ./install.sh)" >&2
  exit 1
fi

# Confirmed by actually running the bundle, not assumed: Node 18.19.1 (Ubuntu 24.04's
# own `nodejs` package) and even the latest Node 20.x lack APIs the libp2p dependency
# chain needs unflagged (global CustomEvent, Promise.withResolvers) - it starts, then
# crash-loops on first use. Only Node 22 has both.
REQUIRED_NODE_MAJOR=22

if ! command -v node >/dev/null 2>&1; then
  echo "node was not found on PATH." >&2
  echo "Install Node.js $REQUIRED_NODE_MAJOR+ first, e.g.:" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x | sudo -E bash -" >&2
  echo "  apt-get install -y nodejs" >&2
  exit 1
fi

NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]]; then
  echo "node $(node --version) is too old - this needs Node.js $REQUIRED_NODE_MAJOR+." >&2
  echo "Ubuntu's own apt nodejs package is too old for this; install from NodeSource:" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x | sudo -E bash -" >&2
  echo "  apt-get install -y nodejs" >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "Creating system user '$SERVICE_USER'..."
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 750 "$DATA_DIR"
install -d -m 755 "$INSTALL_DIR"
install -d -o root -g "$SERVICE_USER" -m 750 "$CONFIG_DIR"

install -m 755 "$SCRIPT_DIR/helix-relay.cjs" "$INSTALL_DIR/helix-relay.cjs"

if [[ -f "$CONFIG_DIR/helix-relay.env" ]]; then
  echo "Existing config at $CONFIG_DIR/helix-relay.env left untouched."
else
  install -o root -g "$SERVICE_USER" -m 640 "$SCRIPT_DIR/helix-relay.env.example" "$CONFIG_DIR/helix-relay.env"
  echo "Wrote default config to $CONFIG_DIR/helix-relay.env"
fi

install -m 644 "$SCRIPT_DIR/helix-relay.service" "$UNIT_PATH"

systemctl daemon-reload

cat <<EOF

Installed. Before starting:
  1. Review $CONFIG_DIR/helix-relay.env - set HELIX_RELAY_PROXY if this host is
     behind a reverse proxy, or confirm HELIX_RELAY_PORT is reachable directly.
  2. systemctl enable --now helix-relay
  3. journalctl -u helix-relay -f
EOF
