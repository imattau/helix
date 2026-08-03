import { useEffect, useState } from "react";
import { ArrowLeft, Search as SearchIcon } from "lucide-react";
import { ScreenFrame } from "../components/ScreenFrame";
import { Avatar } from "../components/Avatar";
import { PostCard } from "../components/PostCard";
import { BottomNav, type NavTab } from "../components/BottomNav";
import { useHelixState } from "../backend/HelixProvider";
import type { Post, User } from "../types";

const DEBOUNCE_MS = 200;

/**
 * Backed by HelixClient.search(), a full-text search over post content and
 * display names built on PolyPack's PolyGraph (see src/backend/searchIndex.ts) -
 * the search buttons elsewhere in the app (HomeFeedScreen's header icon, the
 * nav rail/bottom nav "search" tab) all route here. No Figma design exists for
 * this screen yet, so it's built from the app's existing token/component set
 * rather than a specific mockup.
 */
export function SearchScreen({
  onBack,
  onOpenPost,
  onOpenAuthor,
  onNavTab,
}: {
  onBack: () => void;
  onOpenPost: (postId: string) => void;
  onOpenAuthor: (userId: string) => void;
  onNavTab: (tab: NavTab) => void;
}) {
  const client = useHelixState();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ posts: Post[]; users: User[] }>({ posts: [], users: [] });

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults({ posts: [], users: [] });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      client.search(trimmed).then((r) => {
        if (!cancelled) setResults(r);
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, client]);

  const hasQuery = query.trim().length > 0;
  const hasResults = results.posts.length > 0 || results.users.length > 0;

  return (
    <ScreenFrame>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <button type="button" onClick={onBack} aria-label="Back">
            <ArrowLeft size={20} className="text-ink" />
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
            <SearchIcon size={16} className="text-ink-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search posts and people"
              className="w-full bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none"
            />
          </div>
        </div>

        {!hasQuery ? (
          <p className="p-6 text-center text-sm text-ink-muted">Search for posts or people by name.</p>
        ) : !hasResults ? (
          <p className="p-6 text-center text-sm text-ink-muted">No matches for &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          <div className="flex flex-col gap-5 p-4">
            {results.users.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">People</span>
                {results.users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => onOpenAuthor(user.id)}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 text-left"
                  >
                    <Avatar user={user} size="md" />
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-ink">{user.displayName}</span>
                      <span className="text-xs text-ink-muted">{user.handle}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {results.posts.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">Posts</span>
                <div className="flex flex-col gap-3">
                  {results.posts.map((post) => (
                    <PostCard key={post.id} post={post} onOpen={onOpenPost} onOpenAuthor={onOpenAuthor} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <BottomNav active="search" onSelect={onNavTab} />
    </ScreenFrame>
  );
}
