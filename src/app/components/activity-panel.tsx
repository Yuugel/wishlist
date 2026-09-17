"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type ApiActivity = {
  id: string;
  eventType: "wish_changed" | "takeover_released_visibility_lost" | "wish_deleted" | "group_dissolved";
  wishId: string | null;
  wishTitle: string | null;
  takeoverStatus: "reserved" | "purchased" | null;
  groupName: string | null;
  changedFields: Array<"title" | "description" | "link" | "priceText">;
  addedGroupIds: string[];
  removedGroupIds: string[];
  createdAt: string;
};
type ActivityResponse = { activities?: ApiActivity[]; message?: string };

const fieldLabels: Record<ApiActivity["changedFields"][number], string> = {
  title: "Titel", description: "Beschreibung", link: "Link", priceText: "Preis",
};

function changeLabels(activity: ApiActivity): string[] {
  const labels = activity.changedFields.map((field) => fieldLabels[field]);
  if (activity.addedGroupIds.length > 0) labels.push("Gruppe hinzugefügt");
  if (activity.removedGroupIds.length > 0) labels.push("Gruppe entfernt");
  return labels.length > 0 ? labels : ["Wunschdaten"];
}

function activityPresentation(activity: ApiActivity): { heading: string; icon: string; tone: string } {
  switch (activity.eventType) {
    case "wish_changed": return { heading: "Wunsch aktualisiert", icon: "✎", tone: "peach" };
    case "takeover_released_visibility_lost": return { heading: "Reservierung freigegeben", icon: "↗", tone: "blue" };
    case "wish_deleted": return { heading: "Wunsch nicht mehr verfügbar", icon: "×", tone: "rose" };
    case "group_dissolved": return { heading: "Gruppe aufgelöst", icon: "♡", tone: "sage" };
  }
}

function takeoverLabel(status: ApiActivity["takeoverStatus"]): string {
  return status === "purchased" ? "gekauften" : "reservierten";
}

function activityDescription(activity: ApiActivity): string {
  switch (activity.eventType) {
    case "wish_changed": return `Bei „${activity.wishTitle ?? "Unbekannter Wunsch"}“ wurde Folgendes geändert: ${changeLabels(activity).join(", ")}.`;
    case "takeover_released_visibility_lost": return `Deine Übernahme des ${takeoverLabel(activity.takeoverStatus)} Wunsches „${activity.wishTitle ?? "Unbekannter Wunsch"}“ wurde freigegeben, weil keine gemeinsame Gruppe mehr besteht.`;
    case "wish_deleted": return `Der von dir ${takeoverLabel(activity.takeoverStatus)} Wunsch „${activity.wishTitle ?? "Unbekannter Wunsch"}“ wurde gelöscht.`;
    case "group_dissolved": return `Die Gruppe „${activity.groupName ?? "Unbekannt"}“ wurde aufgelöst, nachdem ein Mitglied sie verlassen hat.`;
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function ActivityPanel() {
  const router = useRouter();
  const [activities, setActivities] = useState<ApiActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch("/api/activity", { credentials: "same-origin", cache: "no-store", signal });
      const data = (await response.json().catch(() => ({}))) as ActivityResponse;
      if (!response.ok) {
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        throw new Error(data.message || "Die Activity konnte nicht geladen werden.");
      }
      setActivities(data.activities ?? []);
    } catch (error) {
      if (!signal.aborted) setMessage(error instanceof Error ? error.message : "Die Activity konnte nicht geladen werden.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, reloadKey]);

  return (
    <div className="content-stack">
      <div className="activity-summary">
        <span className="summary-icon" aria-hidden="true">✦</span>
        <div><strong>Diskret informiert</strong><p>Hier erscheinen nur Hinweise, die für dich als schenkende Person bestimmt sind.</p></div>
      </div>

      {message ? <div className="empty-state compact-empty"><span className="empty-state-icon" aria-hidden="true">!</span><h2>Activity gerade nicht erreichbar</h2><p>{message}</p><button type="button" onClick={() => { setMessage(undefined); setLoading(true); setReloadKey((value) => value + 1); }}>Erneut versuchen</button></div> : loading ? (
        <div className="activity-list" aria-label="Activity wird geladen" aria-live="polite"><div className="skeleton-activity" /><div className="skeleton-activity" /><div className="skeleton-activity" /></div>
      ) : activities.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">✦</span>
          <h2>Alles ruhig – und das ist gut so</h2>
          <p>Wenn sich bei einem von dir übernommenen Wunsch etwas Wichtiges ändert, findest du es hier.</p>
          <Link className="button-link secondary" href="/groups">Gruppen entdecken</Link>
        </div>
      ) : (
        <div className="activity-list">
          {activities.map((activity) => {
            const presentation = activityPresentation(activity);
            return (
              <article className="activity-item" key={activity.id}>
                <span className={`activity-icon tone-${presentation.tone}`} aria-hidden="true">{presentation.icon}</span>
                <div className="activity-copy">
                  <div className="activity-heading-row"><h2>{presentation.heading}</h2><time dateTime={activity.createdAt}>{formatDate(activity.createdAt)}</time></div>
                  <p>{activityDescription(activity)}</p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
