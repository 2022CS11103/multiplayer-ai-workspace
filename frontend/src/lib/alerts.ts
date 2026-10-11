/** Desktop notifications for work waiting on you while this tab is in the background. */

export function alertsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function alertsEnabled() {
  return alertsSupported() && Notification.permission === "granted";
}

export async function enableAlerts() {
  if (!alertsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

export function desktopAlert(title: string, body: string) {
  if (!alertsEnabled() || !document.hidden) return;
  try {
    const note = new Notification(title, { body: body.slice(0, 200), tag: title });
    note.onclick = () => {
      window.focus();
      note.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}
