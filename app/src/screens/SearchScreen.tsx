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
 * nav rail/bottom nav "search" tab) all route here. The empty state doubles as
 * the Discover surface: suggestions from HelixClient.getSuggestedUsers() (the
 * 2nd-degree follow ring plus every other known, unfollowed genome) with inline
 * follow buttons and their recent posts. No Figma design exists for this screen
 * yet, so it's built from the app's existing token/component set.
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

  const suggestedUsers = client.getSuggestedUsers();
  const discoverPosts = client.getDiscoverFeed();

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
          <DiscoverSection
            suggestedUsers={suggestedUsers}
            discoverPosts={discoverPosts}
            onOpenPost={onOpenPost}
            onOpenAuthor={onOpenAuthor}
          />
        ) : !hasResults ? (
          <p className="p-6 text-center text-sm text-ink-muted">No matches for &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          <div className="flex flex-col gap-5 p-4">
            {results.users.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">People</span>
                {results.users.map((user) => (
                  <SuggestionRow key={user.id} user={user} onOpenAuthor={onOpenAuthor} />
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

/** "People to follow" row - taps through to the profile, with an inline follow toggle. */
function SuggestionRow({ user, onOpenAuthor }: { user: User; onOpenAuthor: (userId: string) => void }) {
  const client = useHelixState();
  const isSelf = user.id === client.selfGenomeAddress;
  const isFollowing = client.isFollowing(user.id);

  return (
    <div className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-3">
      <button type="button" onClick={() => onOpenAuthor(user.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Avatar user={user} size="md" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-bold text-ink">{user.displayName}</span>
          <span className="truncate text-xs text-ink-muted">{user.handle}</span>
        </div>
      </button>
      {!isSelf && (
        <button
          type="button"
          onClick={() => (isFollowing ? client.unfollow(user.id) : client.follow(user.id))}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${
            isFollowing ? "border-border text-ink-muted" : "border-accent text-accent"
          }`}
        >
          {isFollowing ? "Following" : "Follow"}
        </button>
      )}
    </div>
  );
}

/**
 * Empty-state Discover: who to follow plus their recent posts. Live-updates via
 * useHelixState as gossip and directory sync arrive, so a brand-new user with no
 * follows sees real people and content quickly once the network is reached.
 */
function DiscoverSection({
  suggestedUsers,
  discoverPosts,
  onOpenPost,
  onOpenAuthor,
}: {
  suggestedUsers: User[];
  discoverPosts: Post[];
  onOpenPost: (postId: string) => void;
  onOpenAuthor: (userId: string) => void;
}) {
  const client = useHelixState();

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-bold uppercase tracking-wide text-ink-muted">Discover</span>
        <button
          type="button"
          onClick={() => client.requestDirectoryRefresh()}
          className="text-xs font-semibold text-accent"
        >
          Find peers
        </button>
      </div>

      {suggestedUsers.length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-muted">
          {client.hasNetworkContact
            ? "Nobody new on the network yet - search by name to find people."
            : "Finding peers on the network… new people will show up here as soon as this device connects to other Helix peers."}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className="px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">People to follow</span>
            {suggestedUsers.map((user) => (
              <SuggestionRow key={user.id} user={user} onOpenAuthor={onOpenAuthor} />
            ))}
          </div>

          {discoverPosts.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">Recent posts</span>
              <div className="flex flex-col gap-3">
                {discoverPosts.map((post) => (
                  <PostCard key={post.id} post={post} onOpen={onOpenPost} onOpenAuthor={onOpenAuthor} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
