export const TOPICS = {
  GENESIS: 'helix-genesis',
  POSTS: 'helix-posts',
  FOLLOWS: 'helix-follows',
  /** Signaling only: announces a peer's separate IPFS node's multiaddrs so others can
   * dial it directly - mDNS auto-discovery between two independent Helia nodes proved
   * unreliable within a reasonable window, so the already-working Helix gossipsub
   * channel is reused for this instead of adding a second --bootstrap flag. */
  IPFS_ADDR: 'helix-ipfs-addr',
  /** Periodic directory snapshots (genomes + recent posts) for peer bootstrap - see
   *  src/node/directory.ts. Complements the request-response `/helix/directory/1.0.0`
   *  protocol with passive, eventual propagation. */
  DIRECTORY: 'helix-directory',
} as const;
