import { Heart, RefreshCw, MessageCircleReply, UserPlus } from "lucide-react";
import { ScreenFrame } from "../components/ScreenFrame";
import { Avatar } from "../components/Avatar";
import { BottomNav, type NavTab } from "../components/BottomNav";
import { useHelixState } from "../backend/HelixProvider";
import type { Notification } from "../types";

const ICON: Record<Notification["kind"], typeof Heart> = {
  like: Heart,
  boost: RefreshCw,
  reply: MessageCircleReply,
  follow: UserPlus,
};

const VERB: Record<Notification["kind"], string> = {
  like: "liked your post",
  boost: "boosted your post",
  reply: "replied to your post",
  follow: "followed you",
};

/**
 * Likes, boosts, replies, and new followers - all derived client-side from
 * HelixClient.getNotifications() (posts already seen plus the follow event log -
 * see client.ts) rather than a separate persisted notification store. No Figma
 * design exists for this screen yet, built from the app's existing conventions.
 */
export function NotificationsScreen({
  onOpenPost,
  onOpenAuthor,
  onNavTab,
}: {
  onOpenPost: (postId: string) => void;
  onOpenAuthor: (userId: string) => void;
  onNavTab: (tab: NavTab) => void;
}) {
  const client = useHelixState();
  const notifications = client.getNotifications();

  return (
    <ScreenFrame>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="border-b border-border px-5 py-3">
          <span className="text-[15px] font-bold text-ink">Notifications</span>
        </div>

        {notifications.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-muted">
            Nothing yet - likes, boosts, replies, and new followers will show up here.
          </p>
        ) : (
          <div className="flex flex-col gap-2 p-4">
            {notifications.map((n) => {
              const Icon = ICON[n.kind];
              return (
                <div key={n.id} className="flex w-full items-start gap-3 rounded-2xl border border-border bg-surface p-3">
                  <Icon size={18} className="mt-2 shrink-0 text-accent" />
                  <button type="button" onClick={() => onOpenAuthor(n.actor.id)} className="shrink-0">
                    <Avatar user={n.actor} size="sm" />
                  </button>
                  <button
                    type="button"
                    onClick={() => (n.targetPostId ? onOpenPost(n.targetPostId) : onOpenAuthor(n.actor.id))}
                    className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                  >
                    <p className="text-sm text-ink">
                      <span className="font-bold">{n.actor.displayName}</span> {VERB[n.kind]}
                    </p>
                    {n.targetExcerpt && <p className="truncate text-xs text-ink-muted">{n.targetExcerpt}</p>}
                    <span className="text-xs text-ink-faint">{n.timeAgo}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <BottomNav active="notifications" onSelect={onNavTab} />
    </ScreenFrame>
  );
}
