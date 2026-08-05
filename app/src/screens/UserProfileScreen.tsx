import { useState } from "react";
import { ArrowLeft, MoreVertical, BadgeCheck, QrCode } from "lucide-react";
import { ScreenFrame } from "../components/ScreenFrame";
import { Avatar } from "../components/Avatar";
import { PostCard } from "../components/PostCard";
import { BottomNav, type NavTab } from "../components/BottomNav";
import { useHelixState } from "../backend/HelixProvider";

function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

export function UserProfileScreen({
  userId,
  onBack,
  onOpenSettings,
  onOpenPost,
  onOpenQrPairing,
  onOpenFollowList,
  onNavTab,
}: {
  userId: string;
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenPost: (postId: string) => void;
  onOpenQrPairing: () => void;
  onOpenFollowList: (mode: "following" | "followers") => void;
  onNavTab: (tab: NavTab) => void;
}) {
  const client = useHelixState();
  const user = client.getUser(userId);
  const [tab, setTab] = useState<"posts" | "boosts">("posts");
  const posts = user ? client.getPostsByAuthor(user.id) : [];
  const isSelf = user?.id === client.selfGenomeAddress;
  const isFollowing = user ? client.isFollowing(user.id) : false;

  if (!user) {
    return (
      <ScreenFrame>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-sm text-ink-muted">This profile hasn't been observed on the network yet.</p>
          <button type="button" onClick={onBack} className="text-sm font-semibold text-accent">
            Go back
          </button>
        </div>
        <BottomNav active="profile" onSelect={onNavTab} />
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3">
          <button type="button" onClick={onBack} aria-label="Back">
            <ArrowLeft size={20} className="text-ink" />
          </button>
          <span className="text-[15px] font-bold text-ink">{user.handle}</span>
          <div className="flex items-center gap-3">
            {isSelf && (
              <button type="button" onClick={onOpenQrPairing} aria-label="Connect via QR">
                <QrCode size={20} className="text-ink" />
              </button>
            )}
            <button type="button" onClick={onOpenSettings} aria-label="More">
              <MoreVertical size={20} className="text-ink" />
            </button>
          </div>
        </div>

        <div className="flex w-full flex-col gap-4 border-b border-border bg-surface p-5">
          <div className="flex w-full items-center justify-between">
            <Avatar user={user} size="xl" />
            {!isSelf && (
              <button
                type="button"
                onClick={() => (isFollowing ? client.unfollow(user.id) : client.follow(user.id))}
                className={`rounded-[20px] px-[18px] py-2 text-[13px] font-bold ${
                  isFollowing ? "border border-border text-ink" : "bg-accent text-white"
                }`}
              >
                {isFollowing ? "Following" : "Follow"}
              </button>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className="font-display text-xl font-extrabold text-ink">{user.displayName}</span>
              {user.verified && <BadgeCheck size={18} className="text-accent" />}
            </div>
            <span className="text-sm text-ink-muted">{user.handle}</span>
          </div>
          <div className="flex items-center gap-4 whitespace-nowrap text-[13px] text-ink-muted">
            <button type="button" onClick={() => onOpenFollowList("following")}>
              <span className="font-bold text-ink">{formatCount(user.followingCount ?? 0)}</span> Following
            </button>
            <button type="button" onClick={() => onOpenFollowList("followers")}>
              <span className="font-bold text-ink">{formatCount(user.followerCount ?? 0)}</span> Followers
            </button>
          </div>
        </div>

        <div className="flex w-full items-start border border-border bg-surface">
          <button
            type="button"
            onClick={() => setTab("posts")}
            className={`flex-1 py-3.5 text-sm font-bold ${tab === "posts" ? "border-b-[3px] border-accent text-ink" : "text-ink-muted"}`}
          >
            Posts ({posts.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("boosts")}
            className={`flex-1 py-3.5 text-sm font-semibold ${tab === "boosts" ? "border-b-[3px] border-accent text-ink" : "text-ink-muted"}`}
          >
            Boosts (0)
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          {tab === "posts" ? (
            posts.map((post) => <PostCard key={post.id} post={post} onOpen={onOpenPost} />)
          ) : (
            <p className="text-sm text-ink-muted">No boosts yet.</p>
          )}
        </div>
      </div>

      <BottomNav active="profile" onSelect={onNavTab} />
    </ScreenFrame>
  );
}
