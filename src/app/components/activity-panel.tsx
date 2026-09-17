"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ApiActivity = {
  id: string;
  eventType: "wish_changed";
  wishId: string | null;
  wishTitle: string;
  changedFields: Array<"title" | "description" | "link" | "priceText">;
  addedGroupIds: string[];
  removedGroupIds: string[];
  createdAt: string;
};

type ActivityResponse = {
  activities?: ApiActivity[];
  message?: string;
};

const fieldLabels: Record<ApiActivity["changedFields"][number], string> = {
  title: "Titel",
  description: "Beschreibung/Notiz",
  link: "Link",
  priceText: "Preis",
};

function changeLabels(activity: ApiActivity): string[] {
  const labels = activity.changedFields.map((field) => fieldLabels[field]);
  if (activity.addedGroupIds.length > 0) labels.push("Gruppe hinzugefügt");
  if (activity.removedGroupIds.length > 0) labels.push("Gruppe entfernt");
  return labels.length > 0 ? labels : ["Wish-Daten"];
}

function activityDescription(activity: ApiActivity): string {
  return `Der Wunsch „${activity.wishTitle}“ wurde geändert: ${changeLabels(activity).join(", ")}.`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function ActivityPanel() {
  const router = useRouter();
  const [activities, setActivities] = useState<ApiActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/activity", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as ActivityResponse;
        if (!response.ok) {
          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          throw new Error(
            data.message || "Die Activity konnte nicht geladen werden.",
          );
        }
        if (!cancelled) setActivities(data.activities ?? []);
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Die Activity konnte nicht geladen werden.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="stack">
      <div className="actions">
        <Link className="button-link secondary" href="/wishlist">
          Meine Wunschliste
        </Link>
        <Link className="button-link secondary" href="/groups">
          Meine Gruppen
        </Link>
      </div>

      {message && <p className="notice" role="alert">{message}</p>}
      {loading ? (
        <p className="intro">Activity wird geladen …</p>
      ) : activities.length === 0 ? (
        <p className="intro">Noch keine Activity-Einträge.</p>
      ) : (
        <div className="activity-list">
          {activities.map((activity) => (
            <article className="activity-item" key={activity.id}>
              <h2>Wunsch geändert</h2>
              <p>{activityDescription(activity)}</p>
              <time dateTime={activity.createdAt}>
                {formatDate(activity.createdAt)}
              </time>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
