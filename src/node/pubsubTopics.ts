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
  /** Self-reported dialable multiaddrs for the MAIN node (getOwnConnectAddrs()'s
   *  output) - same "announce your own address over the already-working gossipsub
   *  channel" pattern as IPFS_ADDR above, just for the main node instead of Helia. A
   *  relay (src/cli/relay.ts) that's meshed with a peer via this topic can build a
   *  genuinely dialable peer directory (genome + real address, not just a bare
   *  peerId a receiver would otherwise need a DHT peer-routing lookup to resolve) -
   *  see directory.ts's optional multiaddrs field on DirectoryEntry. */
  PEER_ADDR: 'helix-peer-addr',
} as const;
