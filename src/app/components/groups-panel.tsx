"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ApiGroup = {
  id: string;
  name: string;
  createdAt: string;
};

export function GroupsPanel() {
  const router = useRouter();
  const [groups, setGroups] = useState<ApiGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/groups", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as {
          groups?: ApiGroup[];
          message?: string;
        };
        if (!response.ok) {
          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          throw new Error(data.message || "Die Gruppen konnten nicht geladen werden.");
        }
        if (!cancelled) setGroups(data.groups ?? []);
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Die Gruppen konnten nicht geladen werden.",
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
        <Link className="button-link secondary" href="/account">
          Konto
        </Link>
      </div>

      {message && <p className="notice" role="alert">{message}</p>}
      {loading ? (
        <p className="intro">Gruppen werden geladen …</p>
      ) : groups.length === 0 ? (
        <p className="intro">
          Du bist noch keiner Gruppe beigetreten. Sobald eine Gruppe vorhanden
          ist, kannst du ihre Mitglieder und Wünsche hier öffnen.
        </p>
      ) : (
        <div className="group-list">
          {groups.map((group) => (
            <Link className="group-link" href={`/groups/${group.id}`} key={group.id}>
              <strong>{group.name}</strong>
              <span>Gruppe öffnen</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
