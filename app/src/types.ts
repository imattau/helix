export interface User {
  id: string;
  displayName: string;
  handle: string;
  verified: boolean;
  bio?: string;
  joined?: string;
  followingCount?: number;
  followerCount?: number;
  /** Deterministic color for the generated placeholder avatar. */
  avatarColor: string;
}

export interface Post {
  id: string;
  author: User;
  content: string;
  timeAgo: string;
  timestamp?: string;
  sealed: boolean;
  replyCount: number;
  boostCount: number;
  likeCount: number;
  /** True when this post is a recombination (edit) of an earlier post - see HelixClient.recombine. */
  wasEdited?: boolean;
}
