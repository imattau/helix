import { Search, PlusCircle } from "lucide-react";
import { ScreenFrame } from "../components/ScreenFrame";
import { PostCard } from "../components/PostCard";
import { BottomNav, type NavTab } from "../components/BottomNav";
import { Logo } from "../components/Logo";
import type { Post } from "../types";

export function HomeFeedScreen({
  posts,
  onOpenPost,
  onOpenAuthor,
  onCompose,
  onNavTab,
  onSearch,
}: {
  posts: Post[];
  onOpenPost: (postId: string) => void;
  onOpenAuthor: (userId: string) => void;
  onCompose: () => void;
  onNavTab: (tab: NavTab) => void;
  onSearch: () => void;
}) {
  return (
    <ScreenFrame>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border px-5 pb-4 pt-3">
          <Logo size="sm" />
          <button
            type="button"
            onClick={onSearch}
            className="flex size-[38px] items-center justify-center rounded-full border border-border bg-surface"
            aria-label="Search"
          >
            <Search size={18} className="text-ink" />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onOpen={onOpenPost} onOpenAuthor={onOpenAuthor} />
          ))}
        </div>
      </div>

      <div className="flex w-full flex-col">
        <div className="relative flex justify-end px-5">
          <button
            type="button"
            onClick={onCompose}
            className="absolute -top-[74px] flex items-center justify-center rounded-[28px] bg-accent p-4 shadow-[0_8px_8px_rgba(94,80,249,0.4)]"
            aria-label="Compose"
          >
            <PlusCircle size={24} className="text-white" />
          </button>
        </div>
        <BottomNav active="home" onSelect={onNavTab} />
      </div>
    </ScreenFrame>
  );
}
