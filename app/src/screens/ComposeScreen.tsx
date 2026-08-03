import { useEffect, useRef, useState } from "react";
import { ShieldAlert, GalleryThumbnails, Link2, Hash, MapPin, X } from "lucide-react";
import { ScreenFrame } from "../components/ScreenFrame";
import { Avatar } from "../components/Avatar";
import { useHelixState } from "../backend/HelixProvider";
import type { Post } from "../types";

const MAX_LENGTH = 280;

/** A media/long-form attachment picked by the user before publishing. */
export interface ComposeAttachment {
  bytes: Uint8Array;
  mimeType: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  onPublish: (content: string, attachment?: ComposeAttachment) => void;
  editingPost?: Post;
  replyToPost?: Post;
}) {
  const client = useHelixState();
  const currentUser = client.getSelfUser();
  const [content, setContent] = useState(editingPost?.content ?? "");
  const [attachment, setAttachment] = useState<ComposeAttachment>();
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Editing carries the original attachment forward (the new version re-hashes the same
  // bytes) - verify-fetch the original so its bytes are available to republish.
  useEffect(() => {
    const original = editingPost?.attachment;
    if (!original) return;
    let cancelled = false;
    setLoadingOriginal(true);
    client
      .fetchAttachmentBytes(original)
      .then(
        (bytes) => {
          if (!cancelled) setAttachment({ bytes, mimeType: original.mimeType });
        },
        (err) => console.warn("[helix] could not load original attachment for edit - will republish without media", err),
      )
      .finally(() => {
        if (!cancelled) setLoadingOriginal(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, editingPost?.attachment?.hashHex]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    file.arrayBuffer().then(
      (buf) => setAttachment({ bytes: new Uint8Array(buf), mimeType: file.type || "application/octet-stream" }),
      (err) => console.warn("[helix] failed to read attachment file", err),
    );
  };

  return (
    <ScreenFrame>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border px-5 pb-4 pt-3">
          <button type="button" onClick={onCancel} className="text-[15px] font-semibold text-ink-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => content.trim() && onPublish(content, attachment)}
            disabled={!content.trim() || content.length > MAX_LENGTH || loadingOriginal}
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

          {attachment && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-alt px-3 py-2">
              <GalleryThumbnails size={14} className="shrink-0 text-ink-muted" />
              <span className="flex-1 truncate text-xs text-ink-muted">
                {attachment.mimeType} • {formatBytes(attachment.bytes.length)}
              </span>
              <button type="button" onClick={() => setAttachment(undefined)} aria-label="Remove attachment">
                <X size={14} className="text-ink-muted" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="w-full border border-border">
        <div className="flex w-full items-center justify-between bg-surface px-5 py-3">
          <div className="flex items-center gap-4">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach media"
              className="text-ink-muted"
            >
              <GalleryThumbnails size={20} />
            </button>
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
