import { useEffect, useState, type ReactNode } from "react";
import { HomeFeedScreen } from "./screens/HomeFeedScreen";
import { PostDetailScreen } from "./screens/PostDetailScreen";
import { UserProfileScreen } from "./screens/UserProfileScreen";
import { ComposeScreen, type ComposeAttachment } from "./screens/ComposeScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { EditProfileScreen } from "./screens/EditProfileScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { BackupKeyScreen } from "./screens/BackupKeyScreen";
import { QrPairingScreen } from "./screens/QrPairingScreen";
import { BlockedAccountsScreen } from "./screens/BlockedAccountsScreen";
import { WhoCanReplyScreen } from "./screens/WhoCanReplyScreen";
import { NotificationSettingsScreen } from "./screens/NotificationSettingsScreen";
import { LanguageScreen } from "./screens/LanguageScreen";
import { AboutScreen } from "./screens/AboutScreen";
import { BootstrapServerScreen } from "./screens/BootstrapServerScreen";
import { registerBootstrapDeepLinkHandler } from "./backend/deepLink";
import { useHelixState } from "./backend/HelixProvider";
import { useTheme } from "./hooks/useTheme";
import { NavRail } from "./components/NavRail";
import { FeedListPane } from "./components/FeedListPane";
import type { NavTab } from "./components/BottomNav";
import type { Post } from "./types";

type Route =
  | { screen: "home" }
  | { screen: "detail"; postId: string }
  | { screen: "profile"; userId: string }
  | { screen: "compose"; editingPostId?: string; replyToPostId?: string }
  | { screen: "settings" }
  | { screen: "editProfile" }
  | { screen: "search" }
  | { screen: "notifications" }
  | { screen: "backupKey" }
  | { screen: "qrPairing" }
  | { screen: "blockedAccounts" }
  | { screen: "whoCanReply" }
  | { screen: "notificationSettings" }
  | { screen: "language" }
  | { screen: "about" }
  | { screen: "bootstrapServer"; prefillAddr?: string };

function App() {
  const client = useHelixState();
  const [theme, setTheme] = useTheme();
  const [stack, setStack] = useState<Route[]>([{ screen: "home" }]);
  const getFeedPosts = (): Post[] => client.getFeedPosts().filter((post) => !client.isBlocked(post.author.id));

  const push = (route: Route) => setStack((s) => [...s, route]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  // A helix://bootstrap?addr=... link (tapped from the relay's own webpage, or a QR
  // scan on a platform without camera access to the app itself) jumps straight to
  // BootstrapServerScreen with the address pre-filled - never auto-saved, see
  // deepLink.ts's doc comment for why. Registered once for the app's lifetime.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    registerBootstrapDeepLinkHandler((addr) => {
      setStack((s) => [...s, { screen: "bootstrapServer", prefillAddr: addr }]);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);
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
          posts={getFeedPosts()}
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
          onOpenQrPairing={() => push({ screen: "qrPairing" })}
          onNavTab={handleNavTab}
        />
      );
      break;
    case "qrPairing":
      screen = (
        <QrPairingScreen
          initialMode="show"
          onDone={pop}
          onOpenAuthor={(userId) => setStack((s) => [...s.slice(0, -1), { screen: "profile", userId }])}
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
          theme={theme}
          onThemeChange={setTheme}
          onOpenBlockedAccounts={() => push({ screen: "blockedAccounts" })}
          onOpenWhoCanReply={() => push({ screen: "whoCanReply" })}
          onOpenNotificationSettings={() => push({ screen: "notificationSettings" })}
          onOpenLanguage={() => push({ screen: "language" })}
          onOpenAbout={() => push({ screen: "about" })}
          onOpenBootstrapServer={() => push({ screen: "bootstrapServer" })}
        />
      );
      break;
    case "backupKey":
      screen = <BackupKeyScreen mode="settings" onDone={pop} />;
      break;
    case "editProfile":
      screen = <EditProfileScreen onCancel={pop} onSaved={pop} />;
      break;
    case "blockedAccounts":
      screen = <BlockedAccountsScreen onBack={pop} />;
      break;
    case "whoCanReply":
      screen = <WhoCanReplyScreen onBack={pop} />;
      break;
    case "notificationSettings":
      screen = <NotificationSettingsScreen onBack={pop} />;
      break;
    case "language":
      screen = <LanguageScreen onBack={pop} />;
      break;
    case "about":
      screen = <AboutScreen onBack={pop} />;
      break;
    case "bootstrapServer":
      screen = <BootstrapServerScreen onBack={pop} initialAddr={current.prefillAddr} />;
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
  const showNavRail =
    current.screen !== "settings" &&
    current.screen !== "editProfile" &&
    current.screen !== "backupKey" &&
    current.screen !== "qrPairing" &&
    current.screen !== "blockedAccounts" &&
    current.screen !== "whoCanReply" &&
    current.screen !== "notificationSettings" &&
    current.screen !== "language" &&
    current.screen !== "about" &&
    current.screen !== "bootstrapServer";
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
      {showFeedPane && <FeedListPane posts={getFeedPosts()} onOpenPost={(postId) => push({ screen: "detail", postId })} />}
      <div className="min-w-0 flex-1">{screen}</div>
    </div>
  );
}

export default App;
