import { useState, type ReactNode } from "react";
import { HomeFeedScreen } from "./screens/HomeFeedScreen";
import { PostDetailScreen } from "./screens/PostDetailScreen";
import { UserProfileScreen } from "./screens/UserProfileScreen";
import { ComposeScreen, type ComposeAttachment } from "./screens/ComposeScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { EditProfileScreen } from "./screens/EditProfileScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { BackupKeyScreen } from "./screens/BackupKeyScreen";
import { useHelixState } from "./backend/HelixProvider";
import { NavRail } from "./components/NavRail";
import { FeedListPane } from "./components/FeedListPane";
import type { NavTab } from "./components/BottomNav";

type Route =
  | { screen: "home" }
  | { screen: "detail"; postId: string }
  | { screen: "profile"; userId: string }
  | { screen: "compose"; editingPostId?: string; replyToPostId?: string }
  | { screen: "settings" }
  | { screen: "editProfile" }
  | { screen: "search" }
  | { screen: "notifications" }
  | { screen: "backupKey" };

function App() {
  const client = useHelixState();
  const [stack, setStack] = useState<Route[]>([{ screen: "home" }]);

  const push = (route: Route) => setStack((s) => [...s, route]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const current = stack[stack.length - 1];

  const handleNavTab = (tab: NavTab) => {
    if (tab === "home") setStack([{ screen: "home" }]);
    else if (tab === "search") push({ screen: "search" });
    else if (tab === "notifications") push({ screen: "notifications" });
    else if (tab === "profile" && client.selfGenomeAddress) {
      setStack([{ screen: "home" }, { screen: "profile", userId: client.selfGenomeAddress }]);
    }
  };

  const handlePublish = async (
    content: string,
    editingPostId?: string,
    replyToPostId?: string,
    attachment?: ComposeAttachment,
  ) => {
    if (editingPostId) {
      await client.recombine(editingPostId, content, attachment);
    } else {
      await client.publish(content, replyToPostId, attachment);
    }
    if (replyToPostId) {
      setStack((s) => s.slice(0, -1)); // back to the thread being replied to, not home
    } else {
      setStack([{ screen: "home" }]);
    }
  };

  let screen: ReactNode;
  switch (current.screen) {
    case "home":
      screen = (
        <HomeFeedScreen
          posts={client.getFeedPosts()}
          onOpenPost={(postId) => push({ screen: "detail", postId })}
          onOpenAuthor={(userId) => push({ screen: "profile", userId })}
          onCompose={() => push({ screen: "compose" })}
          onNavTab={handleNavTab}
          onSearch={() => push({ screen: "search" })}
        />
      );
      break;
    case "detail": {
      const post = client.getPost(current.postId);
      screen = !post ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-bg text-ink">
          <p className="text-sm text-ink-muted">This post is no longer available.</p>
          <button type="button" onClick={pop} className="text-sm font-semibold text-accent">
            Go back
          </button>
        </div>
      ) : (
        <PostDetailScreen
          post={post}
          onBack={pop}
          onOpenPost={(postId) => push({ screen: "detail", postId })}
          onOpenAuthor={(userId) => push({ screen: "profile", userId })}
          onEdit={(postId) => push({ screen: "compose", editingPostId: postId })}
          onReply={(postId) => push({ screen: "compose", replyToPostId: postId })}
        />
      );
      break;
    }
    case "profile":
      screen = (
        <UserProfileScreen
          userId={current.userId}
          onBack={pop}
          onOpenSettings={() => push({ screen: "settings" })}
          onOpenPost={(postId) => push({ screen: "detail", postId })}
          onNavTab={handleNavTab}
        />
      );
      break;
    case "compose": {
      const editingPost = current.editingPostId ? client.getPost(current.editingPostId) : undefined;
      const replyToPost = current.replyToPostId ? client.getPost(current.replyToPostId) : undefined;
      screen = (
        <ComposeScreen
          onCancel={pop}
          onPublish={(content, attachment) => handlePublish(content, editingPost?.id, replyToPost?.id, attachment)}
          editingPost={editingPost}
          replyToPost={replyToPost}
        />
      );
      break;
    }
    case "settings":
      screen = (
        <SettingsScreen
          onBack={pop}
          onEditProfile={() => push({ screen: "editProfile" })}
          onBackupKey={() => push({ screen: "backupKey" })}
        />
      );
      break;
    case "backupKey":
      screen = <BackupKeyScreen mode="settings" onDone={pop} />;
      break;
    case "editProfile":
      screen = <EditProfileScreen onCancel={pop} onSaved={pop} />;
      break;
    case "search":
      screen = (
        <SearchScreen
          onBack={pop}
          onOpenPost={(postId) => push({ screen: "detail", postId })}
          onOpenAuthor={(userId) => push({ screen: "profile", userId })}
          onNavTab={handleNavTab}
        />
      );
      break;
    case "notifications":
      screen = (
        <NotificationsScreen
          onOpenPost={(postId) => push({ screen: "detail", postId })}
          onOpenAuthor={(userId) => push({ screen: "profile", userId })}
          onNavTab={handleNavTab}
        />
      );
      break;
  }

  const showFeedPane = current.screen === "detail" || current.screen === "profile" || current.screen === "compose";
  // helix-desktop-settings has its own topbar + sidebar, no nav-rail (see SettingsScreen.tsx) -
  // editProfile is reached from (and returns to) that same settings flow.
  const showNavRail = current.screen !== "settings" && current.screen !== "editProfile" && current.screen !== "backupKey";
  const activeTab: NavTab =
    current.screen === "search" || current.screen === "notifications"
      ? current.screen
      : current.screen === "profile" && current.userId === client.selfGenomeAddress
        ? "profile"
        : "home";

  return (
    <div className="flex h-full w-full">
      {showNavRail && (
        <NavRail
          active={activeTab}
          onSelect={handleNavTab}
          onHome={() => setStack([{ screen: "home" }])}
          onSettings={() => push({ screen: "settings" })}
          selfUser={client.getSelfUser()}
        />
      )}
      {showFeedPane && <FeedListPane posts={client.getFeedPosts()} onOpenPost={(postId) => push({ screen: "detail", postId })} />}
      <div className="min-w-0 flex-1">{screen}</div>
    </div>
  );
}

export default App;
