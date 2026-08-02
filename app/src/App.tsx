import { useState } from "react";
import { HomeFeedScreen } from "./screens/HomeFeedScreen";
import { PostDetailScreen } from "./screens/PostDetailScreen";
import { UserProfileScreen } from "./screens/UserProfileScreen";
import { ComposeScreen } from "./screens/ComposeScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { homeFeedPosts, postReplies, currentUser } from "./data/mockData";
import type { NavTab } from "./components/BottomNav";
import type { Post } from "./types";

type Route =
  | { screen: "home" }
  | { screen: "detail"; postId: string }
  | { screen: "profile"; userId: string }
  | { screen: "compose" }
  | { screen: "settings" };

function App() {
  const [posts, setPosts] = useState<Post[]>(homeFeedPosts);
  const [stack, setStack] = useState<Route[]>([{ screen: "home" }]);

  const push = (route: Route) => setStack((s) => [...s, route]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const current = stack[stack.length - 1];

  const findPost = (postId: string): Post | undefined =>
    posts.find((p) => p.id === postId) ?? postReplies.find((p) => p.id === postId);

  const handleNavTab = (tab: NavTab) => {
    if (tab === "home") setStack([{ screen: "home" }]);
    else if (tab === "profile") setStack([{ screen: "home" }, { screen: "profile", userId: currentUser.id }]);
    // search/notifications have no screen in this pass - intentionally inert
  };

  const handlePublish = (content: string) => {
    const newPost: Post = {
      id: `p-${Date.now()}`,
      author: currentUser,
      content,
      timeAgo: "now",
      sealed: true,
      replyCount: 0,
      boostCount: 0,
      likeCount: 0,
    };
    setPosts((p) => [newPost, ...p]);
    setStack([{ screen: "home" }]);
  };

  switch (current.screen) {
    case "home":
      return (
        <HomeFeedScreen
          posts={posts}
          onOpenPost={(postId) => push({ screen: "detail", postId })}
          onOpenAuthor={(userId) => push({ screen: "profile", userId })}
          onCompose={() => push({ screen: "compose" })}
          onNavTab={handleNavTab}
        />
      );
    case "detail": {
      const post = findPost(current.postId) ?? posts[0];
      return (
        <PostDetailScreen
          post={post}
          onBack={pop}
          onOpenPost={(postId) => push({ screen: "detail", postId })}
          onOpenAuthor={(userId) => push({ screen: "profile", userId })}
        />
      );
    }
    case "profile":
      return (
        <UserProfileScreen
          userId={current.userId}
          onBack={pop}
          onOpenSettings={() => push({ screen: "settings" })}
          onOpenPost={(postId) => push({ screen: "detail", postId })}
          onNavTab={handleNavTab}
        />
      );
    case "compose":
      return <ComposeScreen onCancel={pop} onPublish={handlePublish} />;
    case "settings":
      return <SettingsScreen onBack={pop} />;
  }
}

export default App;
