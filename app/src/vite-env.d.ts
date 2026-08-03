/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** /ws multiaddr (with /p2p/<peerId>) of the local dev bootstrap peer - see `npm run peer:a`. */
  readonly VITE_BOOTSTRAP_MULTIADDR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
