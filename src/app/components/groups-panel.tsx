"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type ApiGroup = { id: string; name: string; createdAt: string };
type Feedback = { tone: "success" | "error"; text: string };

export function GroupsPanel({ leaveResult }: { leaveResult?: "left" | "dissolved" }) {
  const router = useRouter();
  const [groups, setGroups] = useState<ApiGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | undefined>(() => {
    if (leaveResult === "dissolved") {
      return { tone: "success", text: "Du hast die Gruppe verlassen. Weil nur eine Person übrig war, wurde die Gruppe aufgelöst." };
    }
    return leaveResult === "left"
      ? { tone: "success", text: "Du hast die Gruppe verlassen." }
      : undefined;
  });

  const loadGroups = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch("/api/groups", {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      const data = (await response.json().catch(() => ({}))) as { groups?: ApiGroup[]; message?: string };
      if (!response.ok) {
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        throw new Error(data.message || "Die Gruppen konnten nicht geladen werden.");
      }
      setGroups(data.groups ?? []);
    } catch (error) {
      if (signal.aborted) return;
      setFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Die Gruppen konnten nicht geladen werden.",
      });
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadGroups(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadGroups, reloadKey]);

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setFeedback(undefined);
    try {
      const response = await fetch("/api/groups", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await response.json().catch(() => ({}))) as { group?: ApiGroup; error?: string; message?: string };
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok || !data.group) {
        throw new Error(
          data.error === "invalid_group_name"
            ? "Bitte gib einen Gruppennamen mit höchstens 200 Zeichen ein."
            : data.message || "Die Gruppe konnte nicht erstellt werden.",
        );
      }
      const createdGroup = data.group;
      setGroups((current) => [createdGroup, ...current]);
      setName("");
      setShowCreate(false);
      setFeedback({ tone: "success", text: `„${createdGroup.name}“ ist bereit. Du kannst die Gruppe jetzt öffnen und Menschen einladen.` });
    } catch (error) {
      setFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Die Gruppe konnte nicht erstellt werden.",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="content-stack">
      <div className="section-toolbar">
        <div>
          <p className="section-kicker">Deine gemeinsamen Räume</p>
          <p className="section-support">Jede Person darf Gruppen anlegen und in jeder Gruppe Einladungen teilen.</p>
        </div>
        <button
          type="button"
          className="button-with-icon"
          onClick={() => {
            setShowCreate((current) => !current);
            setFeedback(undefined);
          }}
          aria-expanded={showCreate}
          aria-controls="create-group-form"
        >
          <span aria-hidden="true">＋</span> Neue Gruppe
        </button>
      </div>

      {showCreate ? (
        <form className="surface-form" id="create-group-form" onSubmit={createGroup}>
          <div className="form-heading">
            <div>
              <p className="section-kicker">Neuer Gruppenraum</p>
              <h2>Wie soll eure Gruppe heißen?</h2>
            </div>
            <button className="icon-button" type="button" onClick={() => setShowCreate(false)} aria-label="Formular schließen">×</button>
          </div>
          <label>
            Gruppenname
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={200}
              autoFocus
              placeholder="Zum Beispiel Familie oder Lieblingsmenschen"
            />
          </label>
          <p className="hint">Alle Mitglieder sind gleichberechtigt und dürfen später weitere Personen einladen.</p>
          <div className="actions">
            <button type="submit" disabled={creating || name.trim().length === 0}>
              {creating ? "Gruppe wird erstellt …" : "Gruppe erstellen"}
            </button>
            <button className="secondary" type="button" onClick={() => setShowCreate(false)} disabled={creating}>Abbrechen</button>
          </div>
        </form>
      ) : null}

      {feedback ? (
        <p className={`notice notice-${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>
          {feedback.text}
        </p>
      ) : null}

      {loading ? (
        <div className="loading-grid" aria-label="Gruppen werden geladen" aria-live="polite">
          <div className="skeleton-card" /><div className="skeleton-card" />
        </div>
      ) : groups.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">♡</span>
          <h2>Hier darf etwas Gemeinsames entstehen</h2>
          <p>Lege eure erste Gruppe an. Danach kannst du direkt einen sicheren Einladungslink teilen.</p>
          <button type="button" onClick={() => setShowCreate(true)}>Erste Gruppe erstellen</button>
        </div>
      ) : (
        <div className="group-grid">
          {groups.map((group, index) => (
            <Link className="group-card" href={`/groups/${group.id}`} key={group.id}>
              <span className={`group-card-symbol tone-${(index % 3) + 1}`} aria-hidden="true">{group.name.slice(0, 1).toLocaleUpperCase("de-DE")}</span>
              <span className="group-card-copy">
                <strong>{group.name}</strong>
                <small>Wünsche und Mitglieder ansehen</small>
              </span>
              <span className="group-card-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}

      {!loading && feedback?.tone === "error" ? (
        <button className="text-button" type="button" onClick={() => { setLoading(true); setReloadKey((value) => value + 1); }}>Erneut laden</button>
      ) : null}
    </div>
  );
}
