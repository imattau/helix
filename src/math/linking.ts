export interface LinkingNumberInput {
  /** Twist: number of posts in the TAD (including the one being added). */
  postsInTad: number;
  /** Writhe: reply-tree depth of the post being added. */
  totalReplyDepth: number;
}

/**
 * Lk = Twist + Writhe.
 *
 * Deviates from the original pseudocode signature `calculate_linking_number(user_id, tad_merkle_root)`:
 * a user id and a merkle root are identifiers, not counts, so Lk isn't computable from them alone.
 * Callers must look up the actual post/reply topology and pass the counted quantities directly.
 */
export function calculate_linking_number({ postsInTad, totalReplyDepth }: LinkingNumberInput): number {
  return postsInTad + totalReplyDepth;
}
