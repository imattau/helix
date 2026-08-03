import { useState } from "react";
import { ShieldAlert, GalleryThumbnails, Link2, Hash, MapPin } from "lucide-react";
import { ScreenFrame } from "../components/ScreenFrame";
import { Avatar } from "../components/Avatar";
import { useHelixState } from "../backend/HelixProvider";
import type { Post } from "../types";

const MAX_LENGTH = 280;

function CountRing({ count, max }: { count: number; max: number }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(count / max, 1);
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" className="-rotate-90">
      <circle cx={8} cy={8} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={2} />
      <circle
        cx={8}
        cy={8}
        r={radius}
        fill="none"
        stroke={progress >= 1 ? "var(--color-danger)" : "var(--color-accent)"}
        strokeWidth={2}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ComposeScreen({
  onCancel,
  onPublish,
  editingPost,
  replyToPost,
}: {
  onCancel: () => void;
  onPublish: (content: string) => void;
  editingPost?: Post;
  replyToPost?: Post;
}) {
  const client = useHelixState();
  const currentUser = client.getSelfUser();
  const [content, setContent] = useState(editingPost?.content ?? "");

  return (
    <ScreenFrame>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border px-5 pb-4 pt-3">
          <button type="button" onClick={onCancel} className="text-[15px] font-semibold text-ink-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => content.trim() && onPublish(content)}
            disabled={!content.trim() || content.length > MAX_LENGTH}
            className="rounded-[20px] bg-accent px-[18px] py-2 text-[13px] font-bold text-white disabled:opacity-40"
          >
            {editingPost ? "Save Edit" : replyToPost ? "Reply" : "Publish"}
          </button>
        </div>

        <div className="flex w-full items-start gap-2.5 border-b border-warning/25 bg-danger-soft p-4">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning" />
          <p className="flex-1 text-xs leading-relaxed text-warning">
            {editingPost ? (
              <>
                This publishes a new version. The original stays on the public ledger, unchanged and still
                provable — recombining doesn't erase it.
              </>
            ) : (
              <>
                Posts on Helix are permanent, append-only records. They cannot be edited, modified, or deleted once
                published on-chain.
              </>
            )}
          </p>
        </div>

        {replyToPost && (
          <div className="flex w-full items-start gap-2.5 border-b border-border px-5 py-3">
            <Avatar user={replyToPost.author} size="sm" />
            <p className="flex-1 text-xs leading-relaxed text-ink-muted">
              Replying to <span className="font-semibold text-ink">{replyToPost.author.handle}</span>
              <br />
              {replyToPost.content}
            </p>
          </div>
        )}

        <div className="flex w-full flex-col gap-4 p-5">
          {currentUser && (
            <div className="flex items-center gap-3">
              <Avatar user={currentUser} size="md" />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-bold text-ink">{currentUser.displayName}</span>
                <span className="text-xs text-accent">Public Sealed Post</span>
              </div>
            </div>
          )}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={replyToPost ? "Draft permanent reply..." : "What's permanently on your mind?"}
            rows={8}
            className="w-full resize-none bg-transparent text-base leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none"
            autoFocus
          />
        </div>
      </div>

      <div className="w-full border border-border">
        <div className="flex w-full items-center justify-between bg-surface px-5 py-3">
          <div className="flex items-center gap-4">
            <GalleryThumbnails size={20} className="text-ink-muted" />
            <Link2 size={20} className="text-ink-muted" />
            <Hash size={20} className="text-ink-muted" />
            <MapPin size={20} className="text-ink-muted" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-ink-muted">
              <span className="font-bold text-ink">{content.length}</span> / {MAX_LENGTH}
            </span>
            <CountRing count={content.length} max={MAX_LENGTH} />
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}
