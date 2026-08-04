import { TOPICS } from '../node/pubsubTopics.js';
import { encodeFollow } from '../node/messages.js';
import type { HelixNode } from '../node/createNode.js';
import type { HelixStore } from '../store/memoryStore.js';
import type { HybridLogicalClock } from '../clock/hlc.js';
import type { Follow } from '../types/index.js';

export async function followUser(
  node: HelixNode,
  store: HelixStore,
  hlcClock: HybridLogicalClock,
  followerGenome: string,
  followeeGenome: string,
): Promise<Follow> {
  if (followerGenome === followeeGenome) {
    throw new Error('followUser: cannot follow yourself');
  }
  if (!store.hasGenome(followerGenome)) {
    throw new Error(`followUser: unknown follower genome ${followerGenome}`);
  }
  if (!store.hasGenome(followeeGenome)) {
    throw new Error(`followUser: unknown followee genome ${followeeGenome}`);
  }

  const follow: Follow = { followerGenome, followeeGenome, hlcTimestamp: hlcClock.now(), action: 'follow' };
  store.getFollowGraph().addFollow(followerGenome, followeeGenome);

  await node.services.pubsub.publish(TOPICS.FOLLOWS, encodeFollow(follow));

  return follow;
}

/**
 * Removes the follow edge locally and broadcasts it so every receiver mirrors the
 * removal - same validations and "recompute, don't trust" posture as followUser.
 * Idempotent: unfollowing someone you don't follow is a no-op on the graph.
 */
export async function unfollowUser(
  node: HelixNode,
  store: HelixStore,
  hlcClock: HybridLogicalClock,
  followerGenome: string,
  followeeGenome: string,
): Promise<Follow> {
  if (followerGenome === followeeGenome) {
    throw new Error('unfollowUser: cannot unfollow yourself');
  }
  if (!store.hasGenome(followerGenome)) {
    throw new Error(`unfollowUser: unknown follower genome ${followerGenome}`);
  }
  if (!store.hasGenome(followeeGenome)) {
    throw new Error(`unfollowUser: unknown followee genome ${followeeGenome}`);
  }

  const unfollow: Follow = { followerGenome, followeeGenome, hlcTimestamp: hlcClock.now(), action: 'unfollow' };
  store.getFollowGraph().removeFollow(followerGenome, followeeGenome);

  await node.services.pubsub.publish(TOPICS.FOLLOWS, encodeFollow(unfollow));

  return unfollow;
}
