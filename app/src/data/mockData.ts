import type { Post, User } from "../types";

export const currentUser: User = {
  id: "u-mercer",
  displayName: "Alex Mercer",
  handle: "@mercer",
  verified: false,
  avatarColor: "#6366f1",
};

const marcus: User = {
  id: "u-marcus",
  displayName: "Marcus Aurel",
  handle: "@marcus_a",
  verified: true,
  avatarColor: "#5e50f9",
};

const elena: User = {
  id: "u-elena",
  displayName: "Elena Rostova",
  handle: "@elena_r",
  verified: true,
  avatarColor: "#d946ef",
};

const alice: User = {
  id: "u-alice",
  displayName: "Alice Vance",
  handle: "@alice_v",
  verified: true,
  bio: "Designing the future of decentralized networks. 🌐 Drafting research log by log. Permanence is a feature, not a bug.",
  joined: "Joined Dec 2025",
  followingCount: 892,
  followerCount: 14200,
  avatarColor: "#f59e0b",
};

const dave: User = {
  id: "u-dave",
  displayName: "Dave Chen",
  handle: "@dchen",
  verified: true,
  avatarColor: "#22c55e",
};

const sarah: User = {
  id: "u-sarah",
  displayName: "Sarah Jenkins",
  handle: "@sarah_j",
  verified: true,
  avatarColor: "#ec4899",
};

export const homeFeedPosts: Post[] = [
  {
    id: "p-1",
    author: marcus,
    content:
      "Once published, it's out there forever. No edit button, no regret-deletions. Makes you think about the permanence of your thoughts. Welcome to Helix. 🌀",
    timeAgo: "4m",
    timestamp: "9:41 AM • Feb 24, 2026",
    sealed: true,
    replyCount: 12,
    boostCount: 38,
    likeCount: 142,
  },
  {
    id: "p-2",
    author: elena,
    content:
      "Append-only databases for the social web. Reading through older threads feels like reviewing archaeological layers. Nothing hidden, nothing retrofitted. Authentic history.",
    timeAgo: "42m",
    sealed: true,
    replyCount: 5,
    boostCount: 22,
    likeCount: 94,
  },
  {
    id: "p-3",
    author: alice,
    content:
      "Drafting my thesis directly to Helix today. Real-time intellectual commit log. Wish me luck, there is no command-z here!",
    timeAgo: "2h",
    sealed: true,
    replyCount: 47,
    boostCount: 89,
    likeCount: 231,
  },
];

export const profileFeedPosts: Post[] = [
  homeFeedPosts[2],
  {
    id: "p-4",
    author: alice,
    content:
      "Writing is thinking. Permanent writing is disciplined thinking. When you can't hit delete, your filter shifts to quality.",
    timeAgo: "1d",
    sealed: true,
    replyCount: 33,
    boostCount: 142,
    likeCount: 512,
  },
];

export const postReplies: Post[] = [
  {
    id: "r-1",
    author: dave,
    content: "Reminds me of commit logs on git. Immutable commits build trust.",
    timeAgo: "2m",
    sealed: false,
    replyCount: 1,
    boostCount: 2,
    likeCount: 12,
  },
  {
    id: "r-2",
    author: sarah,
    content: "It actually changes how you write. I spent 3 minutes re-reading this before hitting send.",
    timeAgo: "15m",
    sealed: false,
    replyCount: 3,
    boostCount: 8,
    likeCount: 45,
  },
];

const usersById: Record<string, User> = {
  [alice.id]: alice,
  [marcus.id]: marcus,
  [elena.id]: elena,
  [dave.id]: dave,
  [sarah.id]: sarah,
  [currentUser.id]: currentUser,
};

/** Falls back to Alice - the only profile this mock-data pass has a full bio/stats for. */
export function getUserById(id: string): User {
  return usersById[id] ?? alice;
}
