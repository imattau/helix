import { useState } from "react";
import { ArrowLeft, UserMinus, UserPlus } from "lucide-react";
import { Avatar } from "../components/Avatar";
import { useHelixState } from "../backend/HelixProvider";

/**
 * Block/unblock is local-only (no server, no propagation to peers) - see
 * src/social/blockGraph.ts. It just hides a genome's posts from this device's feed
 * (see App.tsx's isBlocked filter). "Add" only offers genomes this peer has actually
 * observed (getSuggestedUsers), since there's no user directory to search beyond
 * what's been seen.
 */
export function BlockedAccountsScreen({ onBack }: { onBack: () => void }) {
  const client = useHelixState();
  const [adding, setAdding] = useState(false);

  const blocked = client.getBlockedGenomes();
  const blockedUsers = blocked.map((g) => client.getUser(g)).filter((u) => u !== undefined);
  const candidates = client
    .getSuggestedUsers(50)
    .filter((u) => !blocked.includes(u.id));

  const handleBlock = (genome: string) => {
    client.blockUser(genome);
    setAdding(false);
  };

  const handleUnblock = (genome: string) => {
    client.unblockUser(genome);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-[402px] flex-col overflow-hidden bg-bg text-ink lg:mx-0 lg:max-w-[1088px] lg:px-10">
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 pb-12 pt-2 lg:px-0">
        <div className="flex w-full items-center justify-between pt-2">
          <button type="button" onClick={onBack} className="flex size-10 items-center justify-center rounded-full bg-surface" aria-label="Back">
            <ArrowLeft size={20} className="text-ink" />
          </button>
          <span className="text-xl font-bold text-ink">Blocked Accounts</span>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="flex size-10 items-center justify-center rounded-full bg-surface"
            aria-label="Block someone"
          >
            <UserPlus size={18} className="text-ink" />
          </button>
        </div>

        {adding && (
          <div className="flex w-full flex-col gap-2 rounded-2xl border border-border bg-surface p-3">
            <span className="px-1 text-xs font-bold uppercase text-ink-muted">Block someone you know</span>
            {candidates.length === 0 ? (
              <p className="px-1 py-3 text-sm text-ink-muted">No other known accounts to block yet.</p>
            ) : (
              candidates.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => handleBlock(user.id)}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-alt"
                >
                  <Avatar user={user} size="sm" />
                  <div className="flex flex-1 flex-col">
                    <span className="text-sm font-semibold text-ink">{user.displayName}</span>
                    <span className="text-xs text-ink-muted">{user.handle}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface">
          {blockedUsers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <UserMinus size={24} className="text-ink-muted" />
              <p className="text-sm text-ink-muted">You haven't blocked anyone.</p>
            </div>
          ) : (
            blockedUsers.map((user, i) => (
              <div
                key={user.id}
                className={`flex items-center justify-between gap-3 px-4 py-3.5 ${i === blockedUsers.length - 1 ? "" : "border-b border-border"}`}
              >
                <div className="flex items-center gap-3">
                  <Avatar user={user} size="sm" />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-ink">{user.displayName}</span>
                    <span className="text-xs text-ink-muted">{user.handle}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleUnblock(user.id)}
                  className="rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-xs font-semibold text-ink"
                >
                  Unblock
                </button>
              </div>
            ))
          )}
        </div>
        <p className="px-1 text-xs leading-relaxed text-ink-faint">
          Blocking hides an account's posts from your feed on this device. It doesn't notify them and isn't
          announced to the network.
        </p>
      </div>
    </div>
  );
}
