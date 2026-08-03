#!/usr/bin/env bash
#
# Creates the Android release signing keystore and prints the exact commands to
# store it as GitHub Actions secrets for .github/workflows/build-android.yml.
#
# A keystore is a SECRET: losing it (or its password) means you can never publish
# an update to an installed app. Back it up somewhere safe and regenerate with your
# own password before shipping - this script's auto-generated password is a starter,
# not a production secret.
#
# Usage:
#   scripts/create-android-keystore.sh                 # -> scripts/android/helix-release.keystore
#   scripts/create-android-keystore.sh /path/to/dir alias [password]
#
# Requires `keytool` (from a JDK). If it's not on PATH, pass KEYTOOL=/path/to/keytool.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/android}"
ALIAS="${2:-helix}"
PASSWORD="${3:-}"
KEYTOOL="${KEYTOOL:-keytool}"

if ! command -v "$KEYTOOL" >/dev/null 2>&1; then
  echo "error: '$KEYTOOL' not found. Install a JDK, or point KEYTOOL at keytool (e.g. Android Studio's \$ANDROID_HOME/jbr/bin/keytool)." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
KEYSTORE="$OUT_DIR/helix-release.keystore"

if [ -f "$KEYSTORE" ]; then
  echo "keystore already exists: $KEYSTORE (reusing it - never overwrite a signing key)"
else
  if [ -z "$PASSWORD" ]; then
    PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
  fi

  echo "generating keystore $KEYSTORE (alias=$ALIAS)..."
  "$KEYTOOL" -genkey -v \
    -keystore "$KEYSTORE" \
    -storetype JKS \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -alias "$ALIAS" \
    -storepass "$PASSWORD" -keypass "$PASSWORD" \
    -dname "CN=Helix, OU=Helix, O=Helix, L=Internet, ST=Internet, C=US" \
    -noprompt

  echo "$PASSWORD" > "$OUT_DIR/.keystore.password"
  chmod 600 "$OUT_DIR/.keystore.password"
fi

STORE_PASSWORD="$(cat "$OUT_DIR/.keystore.password")"
# -w0 is GNU-only (macOS uses -b 0), so strip newlines with tr instead - works everywhere.
BASE64="$(base64 < "$KEYSTORE" | tr -d '\n')"

echo
echo "=== keystore ready ==="
echo "  store file : $KEYSTORE"
echo "  store/key  : $STORE_PASSWORD"
echo "  key alias  : $ALIAS"
echo
echo "Store these as GitHub Actions secrets to sign release builds in CI:"
echo "  gh secret set ANDROID_KEYSTORE_BASE64    --repo imattau/helix --body \"$BASE64\""
echo "  gh secret set ANDROID_KEYSTORE_PASSWORD  --repo imattau/helix --body \"$STORE_PASSWORD\""
echo "  gh secret set ANDROID_KEY_ALIAS          --repo imattau/helix --body \"$ALIAS\""
echo
echo "Local release build (after 'npm run tauri android init'):"
echo "  scripts/setup-android-signing.sh $KEYSTORE \"$STORE_PASSWORD\" \"$ALIAS\""
