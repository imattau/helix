import { MessageCircleReply, RefreshCw, Heart, Send, BadgeCheck } from "lucide-react";
import { Avatar } from "./Avatar";
import { SealedBadge } from "./SealedBadge";
import type { Post } from "../types";

function ActionStat({ icon: Icon, count }: { icon: typeof MessageCircleReply; count: number }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md px-2 py-1">
      <Icon size={16} className="text-ink-muted" />
      <span className="text-xs font-semibold text-ink-muted">{count}</span>
    </div>
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
        <ActionStat icon={RefreshCw} count={post.boostCount} />
        <ActionStat icon={Heart} count={post.likeCount} />
        <Send size={16} className="text-ink-muted" />
      </div>
    </div>
  );
}
