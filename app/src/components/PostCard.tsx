import { MessageCircleReply, RefreshCw, Heart, Send, BadgeCheck } from "lucide-react";
import { Avatar } from "./Avatar";
import { SealedBadge } from "./SealedBadge";
import { useHelixState } from "../backend/HelixProvider";
import type { Post } from "../types";

function ActionStat({
  icon: Icon,
  count,
  active,
  onClick,
}: {
  icon: typeof MessageCircleReply;
  count: number;
  active?: boolean;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-2 py-1"
    >
      <Icon size={16} className={active ? "fill-accent text-accent" : "text-ink-muted"} />
      <span className={`text-xs font-semibold ${active ? "text-accent" : "text-ink-muted"}`}>{count}</span>
    </Wrapper>
  );
}

export function PostCard({
  post,
  showSealedBadge = true,
  onOpen,
  onOpenAuthor,
}: {
  post: Post;
  showSealedBadge?: boolean;
  onOpen?: (postId: string) => void;
  onOpenAuthor?: (userId: string) => void;
}) {
  const client = useHelixState();

  return (
    <div className="w-full rounded-2xl border border-border bg-surface p-4 flex flex-col gap-3">
      <div className="flex w-full items-center justify-between">
        <button
          type="button"
          className="flex items-center gap-2.5 text-left"
          onClick={() => onOpenAuthor?.(post.author.id)}
        >
          <Avatar user={post.author} size="md" />
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-ink">{post.author.displayName}</span>
              {post.author.verified && <BadgeCheck size={14} className="text-accent" />}
            </div>
            <span className="text-xs text-ink-muted">
              {post.author.handle} • {post.timeAgo}
              {post.wasEdited && " • Edited"}
            </span>
          </div>
        </button>
        {showSealedBadge && post.sealed && <SealedBadge />}
      </div>

      <button type="button" className="w-full text-left" onClick={() => onOpen?.(post.id)}>
        <p className="text-sm leading-relaxed text-ink">{post.content}</p>
      </button>

      <div className="h-px w-full bg-border" />

      <div className="flex w-full items-center justify-between">
        <ActionStat icon={MessageCircleReply} count={post.replyCount} />
        <ActionStat
          icon={RefreshCw}
          count={post.boostCount}
          active={client.hasBoosted(post.id)}
          onClick={() => (client.hasBoosted(post.id) ? client.unboost(post.id) : client.boost(post.id))}
        />
        <ActionStat
          icon={Heart}
          count={post.likeCount}
          active={client.hasLiked(post.id)}
          onClick={() => (client.hasLiked(post.id) ? client.unlike(post.id) : client.like(post.id))}
        />
        <Send size={16} className="text-ink-muted" />
      </div>
    </div>
  );
}
