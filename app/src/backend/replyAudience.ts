const STORAGE_KEY = "helix.social.replyAudience";

export type ReplyAudience = "everyone" | "followers" | "nobody";

export const REPLY_AUDIENCE_LABEL: Record<ReplyAudience, string> = {
  everyone: "Everyone",
  followers: "Followers only",
  nobody: "Nobody",
};

/** Local preference only - not yet enforced on compose/reply, matching this pass's scope. */
export function getReplyAudience(): ReplyAudience {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "followers" || stored === "nobody" ? stored : "everyone";
}

export function setReplyAudience(audience: ReplyAudience): void {
  localStorage.setItem(STORAGE_KEY, audience);
}
