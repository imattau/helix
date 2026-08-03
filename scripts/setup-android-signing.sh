#!/usr/bin/env bash
#
# Configures Tauri's generated Android project to sign release builds (APK + AAB)
# with the given keystore. Runs after `npm run tauri android init`, since gen/android
# is regenerated fresh every time (see app/src-tauri/.gitignore).
#
# Usage:
#   scripts/setup-android-signing.sh <keystore.jks> <storePassword> [keyAlias]
#
# Writes app/src-tauri/gen/android/keystore.properties and patches the generated
# build.gradle.kts (via scripts/patch-android-signing.mjs). Idempotent; safe to re-run.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: setup-android-signing.sh <keystore.jks> <storePassword> [keyAlias]" >&2
  exit 1
fi

KEYSTORE="$1"
PASSWORD="$2"
ALIAS="${3:-helix}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GEN_DIR="$ROOT/app/src-tauri/gen/android"

if [ ! -d "$GEN_DIR" ]; then
  echo "error: $GEN_DIR not found - run 'npm run tauri android init' first" >&2
  exit 1
fi

if [ ! -f "$KEYSTORE" ]; then
  echo "error: keystore not found at $KEYSTORE (see scripts/create-android-keystore.sh)" >&2
  exit 1
fi

# Use an absolute path so the properties file works regardless of where gradle runs.
KEYSTORE_ABS="$(cd "$(dirname "$KEYSTORE")" && pwd)/$(basename "$KEYSTORE")"

cat > "$GEN_DIR/keystore.properties" <<EOF
password=$PASSWORD
keyAlias=$ALIAS
storeFile=$KEYSTORE_ABS
EOF
chmod 600 "$GEN_DIR/keystore.properties"
echo "[android-signing] wrote $GEN_DIR/keystore.properties (alias=$ALIAS)"

node "$SCRIPT_DIR/patch-android-signing.mjs" "$GEN_DIR/app/build.gradle.kts"
