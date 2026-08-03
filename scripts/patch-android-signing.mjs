#!/usr/bin/env node
//
// Patches Tauri's generated `app/src-tauri/gen/android/app/build.gradle.kts` so release
// builds are signed with the keystore referenced by `gen/android/keystore.properties`.
//
// gen/android is regenerated fresh by `tauri android init` (see src-tauri/.gitignore),
// so this patch is re-applied after every init rather than committed. It is idempotent
// (a marker comment makes a second run a no-op) and defensive: if keystore.properties
// is absent the release buildType simply stays unsigned, so it's safe to run even when
// no signing secrets are configured.
//
// Usage: node scripts/patch-android-signing.mjs <path-to-build.gradle.kts>
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: patch-android-signing.mjs <path-to-build.gradle.kts>");
  process.exit(1);
}

const src = readFileSync(file, "utf8");

if (src.includes("helix-android-signing")) {
  console.log(`[android-signing] already patched: ${file}`);
  process.exit(0);
}

let patched = src;

const IMPORT_ANCHOR = "import java.util.Properties";
if (!patched.includes("import java.io.FileInputStream")) {
  if (!patched.includes(IMPORT_ANCHOR)) {
    console.error(`[android-signing] could not find import anchor '${IMPORT_ANCHOR}' in ${file}`);
    process.exit(1);
  }
  patched = patched.replace(IMPORT_ANCHOR, `${IMPORT_ANCHOR}\nimport java.io.FileInputStream`);
}

const SIGNING_BLOCK = `    signingConfigs {
        create("release") {
            // helix-android-signing
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            if (keystorePropertiesFile.exists()) {
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))
            }
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("password")
            storePassword = keystoreProperties.getProperty("password")
            val storePath = keystoreProperties.getProperty("storeFile")
            if (keystorePropertiesFile.exists() && storePath != null) {
                storeFile = file(storePath)
            }
        }
    }
`;

const BUILDTYPES_ANCHOR = "    buildTypes {";
if (!patched.includes(BUILDTYPES_ANCHOR)) {
  console.error(`[android-signing] could not find '${BUILDTYPES_ANCHOR.trim()}' anchor in ${file}`);
  process.exit(1);
}
patched = patched.replace(BUILDTYPES_ANCHOR, `${SIGNING_BLOCK}${BUILDTYPES_ANCHOR}`);

const RELEASE_ANCHOR = '        getByName("release") {';
if (!patched.includes(RELEASE_ANCHOR)) {
  console.error(`[android-signing] could not find '${RELEASE_ANCHOR.trim()}' anchor in ${file}`);
  process.exit(1);
}
const RELEASE_INSERT = `        getByName("release") {
            // helix-android-signing
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
`;
patched = patched.replace(RELEASE_ANCHOR, RELEASE_INSERT);

writeFileSync(file, patched);
console.log(`[android-signing] patched ${file} for release signing`);
