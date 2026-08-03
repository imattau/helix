import { useState } from "react";
import { ArrowLeft, MessageCircleReply, RefreshCw, Heart, Send, SendHorizontal, PenLine } from "lucide-react";
import { ScreenFrame } from "../components/ScreenFrame";
import { Avatar } from "../components/Avatar";
import { SealedBadge } from "../components/SealedBadge";
import { PostCard } from "../components/PostCard";
import { useHelixState } from "../backend/HelixProvider";
import type { Post } from "../types";

export function PostDetailScreen({
  post,
  onBack,
  onOpenPost,
  onOpenAuthor,
  onEdit,
  onReply,
}: {
  post: Post;
  onBack: () => void;
  onOpenPost: (postId: string) => void;
  onOpenAuthor: (userId: string) => void;
  onEdit: (postId: string) => void;
  onReply: (postId: string) => void;
}) {
  const client = useHelixState();
  const replies = client.getRepliesTo(post.id);
  const selfUser = client.getSelfUser();
  const isOwnPost = post.author.id === client.selfGenomeAddress;
  const [reply, setReply] = useState("");

  const submitReply = () => {
    const content = reply.trim();
    if (!content) return;
    client.publish(content, post.id);
    setReply("");
  };

  return (
    <ScreenFrame>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex items-center gap-3 border-b border-border px-5 pb-4 pt-3">
          <button type="button" onClick={onBack} aria-label="Back">
            <ArrowLeft size={20} className="text-ink" />
          </button>
          <span className="text-base font-bold text-ink">Thread</span>
        </div>

        <div className="flex flex-col gap-4 bg-surface p-5">
          <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => onOpenAuthor(post.author.id)}>
            <Avatar user={post.author} size="lg" />
            <div className="flex flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-1">
                <span className="text-base font-bold text-ink">{post.author.displayName}</span>
              </div>
              <span className="text-[13px] text-ink-muted">{post.author.handle}</span>
            </div>
          </button>

          <p className="text-base leading-relaxed text-ink">{post.content}</p>

          <div className="flex w-full items-center justify-between">
            <span className="text-[13px] text-ink-muted">
              {post.timestamp ?? post.timeAgo}
              {post.wasEdited && " • Edited"}
            </span>
            {post.sealed && <SealedBadge size="lg" />}
          </div>

          <div className="h-px w-full bg-border" />

          <div className="flex w-full items-start gap-4 whitespace-nowrap text-sm text-ink-muted">
            <p>
              <span className="font-bold text-ink">{post.likeCount}</span> Likes
            </p>
            <p>
              <span className="font-bold text-ink">{post.boostCount}</span> Boosts
            </p>
            <p>
              <span className="font-bold text-ink">{post.replyCount}</span> Replies
            </p>
          </div>

          <div className="h-px w-full bg-border" />

          <div className="flex w-full items-center justify-between px-3">
            {/* Mobile replies use the persistent bottom bar; desktop opens the full compose panel. */}
            <MessageCircleReply size={22} className="text-ink-muted lg:hidden" />
            <button type="button" onClick={() => onReply(post.id)} aria-label="Reply" className="hidden lg:inline-flex">
              <MessageCircleReply size={22} className="text-ink-muted" />
            </button>
            <RefreshCw size={22} className="text-ink-muted" />
            <Heart size={22} className="text-ink-muted" />
            <Send size={22} className="text-ink-muted" />
            {isOwnPost && (
              <button type="button" onClick={() => onEdit(post.id)} aria-label="Edit post">
                <PenLine size={22} className="text-ink-muted" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm font-bold text-ink-muted">Replies</p>
          {replies.length === 0 && <p className="text-sm text-ink-faint">No replies yet.</p>}
          {replies.map((r) => (
            <PostCard key={r.id} post={r} showSealedBadge={false} onOpen={onOpenPost} onOpenAuthor={onOpenAuthor} />
          ))}
        </div>
      </div>

      <div className="w-full border border-border">
        <div className="flex w-full items-center gap-2.5 bg-surface p-3">
          {selfUser && <Avatar user={selfUser} size="sm" />}
          <form
            className="flex flex-1 items-center justify-between rounded-full bg-surface-alt px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitReply();
            }}
          >
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Draft permanent reply..."
              className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-muted focus:outline-none"
            />
            <button type="submit" aria-label="Send reply">
              <SendHorizontal size={16} className="text-accent" />
            </button>
          </form>
        </div>
      </div>
    </ScreenFrame>
  );
}
