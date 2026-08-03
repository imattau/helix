import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Avatar } from "./Avatar";
import { useCollapsed } from "../hooks/useCollapsed";
import type { Post } from "../types";

/**
 * Desktop-only secondary pane shown alongside a thread/profile/compose panel -
 * see helix-desktop-thread-view/-profile-view/-compose-view (fileKey
 * Tcmj0lEhCp4OVYATZ4ZHMk): a persistent, compact feed list stays visible so
 * browsing a detail view doesn't lose the surrounding feed context. Collapses
 * to an avatar-only rail; the collapsed state persists across sessions.
 */
export function FeedListPane({ posts, onOpenPost }: { posts: Post[]; onOpenPost: (postId: string) => void }) {
  const [collapsed, setCollapsed] = useCollapsed("helix.pane.feedList");

  if (collapsed) {
    return (
      <div className="hidden w-[72px] shrink-0 flex-col items-center gap-3 overflow-y-auto border-r border-border bg-surface py-4 lg:flex">
        <button type="button" onClick={() => setCollapsed(false)} aria-label="Expand feed list" className="mb-1">
          <PanelLeftOpen size={18} className="text-ink-muted" />
        </button>
        {posts.map((post) => (
          <button type="button" key={post.id} onClick={() => onOpenPost(post.id)} aria-label={post.author.displayName}>
            <Avatar user={post.author} size="sm" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="hidden w-[280px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface lg:flex">
      <div className="flex items-center justify-between px-5 py-4">
        <span className="text-sm font-bold text-ink">Feed</span>
        <button type="button" onClick={() => setCollapsed(true)} aria-label="Collapse feed list">
          <PanelLeftClose size={18} className="text-ink-muted" />
        </button>
      </div>
      <div className="flex flex-col">
        {posts.map((post) => (
          <button
            type="button"
            key={post.id}
            onClick={() => onOpenPost(post.id)}
            className="flex flex-col gap-2 border-b border-border px-4 py-4 text-left"
          >
            <div className="flex items-center gap-2">
              <Avatar user={post.author} size="sm" />
              <span className="text-[13px] font-semibold text-ink">{post.author.displayName}</span>
              <span className="text-xs text-ink-muted">{post.timeAgo}</span>
            </div>
            <p className="line-clamp-2 text-xs leading-relaxed text-ink-muted">{post.content}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
