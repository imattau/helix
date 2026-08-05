import { ArrowLeft } from "lucide-react";
import { Avatar } from "../components/Avatar";
import { useHelixState } from "../backend/HelixProvider";
import type { User } from "../types";

/** "People to follow"-style row, reused here (see SearchScreen.tsx's SuggestionRow -
 *  not imported directly since that one's scoped to that file, but same shape). */
function FollowRow({ user, onOpenAuthor }: { user: User; onOpenAuthor: (userId: string) => void }) {
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
 * Who a user follows, or who follows them - reachable by tapping the (previously
 * static-text) counts on UserProfileScreen. Only ever shows genomes this device has
 * actually observed a record for - same "no user directory beyond what's been seen"
 * constraint as getSuggestedUsers/BlockedAccountsScreen's candidate list - so a
 * followee/follower this peer hasn't encountered yet is silently omitted rather than
 * shown as a broken entry.
 */
export function FollowListScreen({
  userId,
  mode,
  onBack,
  onOpenAuthor,
}: {
  userId: string;
  mode: "following" | "followers";
  onBack: () => void;
  onOpenAuthor: (userId: string) => void;
}) {
  const client = useHelixState();
  const user = client.getUser(userId);
  const list = mode === "following" ? client.getFollowing(userId) : client.getFollowers(userId);
  const title = mode === "following" ? "Following" : "Followers";

  return (
    <div className="mx-auto flex h-full w-full max-w-[402px] flex-col overflow-hidden bg-bg text-ink lg:mx-0 lg:max-w-[1088px] lg:px-10">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 pb-12 pt-2 lg:px-0">
        <div className="flex w-full items-center gap-3 pt-2">
          <button type="button" onClick={onBack} className="flex size-10 items-center justify-center rounded-full bg-surface" aria-label="Back">
            <ArrowLeft size={20} className="text-ink" />
          </button>
          <div className="flex flex-col">
            <span className="text-xl font-bold text-ink">{title}</span>
            {user && <span className="text-xs text-ink-muted">{user.handle}</span>}
          </div>
        </div>

        {list.length === 0 ? (
          <p className="px-1 py-10 text-center text-sm text-ink-muted">
            {mode === "following" ? "Not following anyone yet." : "No followers yet."}
          </p>
        ) : (
          <div className="flex w-full flex-col gap-2">
            {list.map((u) => (
              <FollowRow key={u.id} user={u} onOpenAuthor={onOpenAuthor} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
