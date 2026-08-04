const STORAGE_KEY = "helix.notifications.prefs";

export interface NotificationPrefs {
  push: boolean;
  email: boolean;
  mentions: boolean;
  replies: boolean;
  boosts: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  push: true,
  email: false,
  mentions: true,
  replies: true,
  boosts: true,
};

/** Local toggles only - not yet wired to a real push/email delivery pipeline, matching this pass's scope. */
export function getNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setNotificationPrefs(prefs: NotificationPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
