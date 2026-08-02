export const TOPICS = {
  GENESIS: 'helix-genesis',
  POSTS: 'helix-posts',
  FOLLOWS: 'helix-follows',
  /** Signaling only: announces a peer's separate IPFS node's multiaddrs so others can
   * dial it directly - mDNS auto-discovery between two independent Helia nodes proved
   * unreliable within a reasonable window, so the already-working Helix gossipsub
   * channel is reused for this instead of adding a second --bootstrap flag. */
  IPFS_ADDR: 'helix-ipfs-addr',
} as const;
