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

  const follow: Follow = { followerGenome, followeeGenome, hlcTimestamp: hlcClock.now() };
  store.getFollowGraph().addFollow(followerGenome, followeeGenome);

  await node.services.pubsub.publish(TOPICS.FOLLOWS, encodeFollow(follow));

  return follow;
}
