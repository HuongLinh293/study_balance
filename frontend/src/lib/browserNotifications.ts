import { useEffect, useRef } from "react";

interface Item {
  id: string;
  title: string;
  body: string;
  read: boolean;
}

export const browserNotificationsSupported = () => typeof window !== "undefined" && "Notification" in window;

/** Asks the browser for permission; resolves to whether notifications may be shown. */
export async function enableBrowserNotifications() {
  if (!browserNotificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  return (await Notification.requestPermission()) === "granted";
}

/**
 * Shows a system notification for each reminder that arrives while the tab is in
 * the background (the in-app list already shows it when the tab is visible).
 * Reminders present at the first load are treated as already seen.
 */
export function useBrowserNotifications(items: Item[] | undefined, enabled: boolean) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!items) return;
    if (!seen.current) {
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    const fresh = items.filter((n) => !n.read && !seen.current!.has(n.id));
    for (const n of items) seen.current.add(n.id);
    if (!enabled || !fresh.length || !browserNotificationsSupported()) return;
    if (Notification.permission !== "granted" || !document.hidden) return;
    for (const n of fresh) {
      try {
        const shown = new Notification(n.title, { body: n.body, tag: n.id });
        shown.onclick = () => {
          window.focus();
          shown.close();
        };
      } catch {
        // Some browsers only allow notifications from a service worker; the in-app list still has it.
      }
    }
  }, [items, enabled]);
}
