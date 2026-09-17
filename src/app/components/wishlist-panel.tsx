"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type ApiGroup = { id: string; name: string; createdAt: string };
type ApiWish = {
  id: string;
  title: string;
  description: string | null;
  link: string | null;
  priceText: string | null;
  groups: ApiGroup[];
  createdAt: string;
  updatedAt: string;
};
type WishForm = { title: string; description: string; link: string; priceText: string; groupIds: string[] };
type ApiError = { message?: string };
type Feedback = { tone: "success" | "error"; text: string };

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok) throw new ApiRequestError(data.message || "Die Anfrage ist fehlgeschlagen.", response.status);
  return data as T;
}

function emptyForm(initialGroupId?: string): WishForm {
  return { title: "", description: "", link: "", priceText: "", groupIds: initialGroupId ? [initialGroupId] : [] };
}

export function WishlistPanel({
  initialGroupId,
  initiallyOpen = false,
}: {
  initialGroupId?: string;
  initiallyOpen?: boolean;
}) {
  const router = useRouter();
  const [wishes, setWishes] = useState<ApiWish[]>([]);
  const [groups, setGroups] = useState<ApiGroup[]>([]);
  const [form, setForm] = useState<WishForm>(() => emptyForm(initialGroupId));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(initiallyOpen);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>();

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const [wishResult, groupResult] = await Promise.all([
        requestJson<{ wishes: ApiWish[] }>("/api/wishes", { signal }),
        requestJson<{ groups: ApiGroup[] }>("/api/groups", { signal }),
      ]);
      setWishes(wishResult.wishes);
      setGroups(groupResult.groups);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ApiRequestError && error.status === 401) {
        router.replace("/login");
        return;
      }
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Die Wunschliste konnte nicht geladen werden." });
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

  function startCreate() {
    const contextGroup = initialGroupId && groups.some((group) => group.id === initialGroupId) ? initialGroupId : undefined;
    setEditingId(null);
    setForm(emptyForm(contextGroup));
    setShowForm(true);
    setFeedback(undefined);
  }

  function startEdit(wish: ApiWish) {
    setEditingId(wish.id);
    setForm({
      title: wish.title,
      description: wish.description ?? "",
      link: wish.link ?? "",
      priceText: wish.priceText ?? "",
      groupIds: wish.groups.map((group) => group.id),
    });
    setShowForm(true);
    setConfirmDeleteId(undefined);
    setFeedback(undefined);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
  }

  function toggleGroup(groupId: string, checked: boolean) {
    setForm((current) => {
      const selected = new Set(current.groupIds);
      if (checked) selected.add(groupId);
      else selected.delete(groupId);
      return { ...current, groupIds: [...selected] };
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(undefined);
    try {
      const body = { ...form };
      const result = editingId
        ? await requestJson<{ wish: ApiWish; changes?: { isNoop: boolean } }>(`/api/wishes/${editingId}`, { method: "PATCH", body: JSON.stringify(body) })
        : await requestJson<{ wish: ApiWish; changes?: { isNoop: boolean } }>("/api/wishes", { method: "POST", body: JSON.stringify(body) });

      setWishes((current) => editingId
        ? current.map((wish) => wish.id === result.wish.id ? result.wish : wish)
        : [result.wish, ...current]);
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm());
      if (!result.changes?.isNoop) {
        setFeedback({ tone: "success", text: editingId ? "Dein Wunsch wurde aktualisiert." : "Dein Wunsch ist jetzt auf der Liste." });
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        router.replace("/login");
        return;
      }
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Der Wunsch konnte nicht gespeichert werden." });
    } finally {
      setBusy(false);
    }
  }

  async function removeWish(wish: ApiWish) {
    setDeletingId(wish.id);
    setFeedback(undefined);
    try {
      await requestJson(`/api/wishes/${wish.id}`, { method: "DELETE" });
      setWishes((current) => current.filter((item) => item.id !== wish.id));
      if (editingId === wish.id) cancelForm();
      setConfirmDeleteId(undefined);
      setFeedback({ tone: "success", text: `„${wish.title}“ wurde gelöscht.` });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        router.replace("/login");
        return;
      }
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Der Wunsch konnte nicht gelöscht werden." });
    } finally {
      setDeletingId(undefined);
    }
  }

  const contextGroup = groups.find((group) => group.id === initialGroupId);

  return (
    <div className="content-stack">
      <div className="section-toolbar">
        <div>
          <p className="section-kicker">{wishes.length === 1 ? "1 Wunsch" : `${wishes.length} Wünsche`}</p>
          <p className="section-support">Ohne Gruppenauswahl bleibt ein Wunsch ganz privat.</p>
        </div>
        <button type="button" className="button-with-icon" onClick={startCreate} disabled={busy || loading}>
          <span aria-hidden="true">＋</span> Wunsch hinzufügen
        </button>
      </div>

      {contextGroup && showForm && !editingId ? (
        <p className="context-note"><span aria-hidden="true">♡</span> Dieser Wunsch wird direkt mit <strong>{contextGroup.name}</strong> geteilt. Du kannst die Auswahl unten ändern.</p>
      ) : null}

      {showForm ? (
        <form className="surface-form wish-form" onSubmit={submit}>
          <div className="form-heading">
            <div>
              <p className="section-kicker">{editingId ? "Feinschliff" : "Etwas Schönes im Sinn?"}</p>
              <h2>{editingId ? "Wunsch bearbeiten" : "Neuer Wunsch"}</h2>
            </div>
            <button className="icon-button" type="button" onClick={cancelForm} disabled={busy} aria-label="Formular schließen">×</button>
          </div>
          <label>
            Titel
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required maxLength={200} autoFocus placeholder="Was wünschst du dir?" />
          </label>
          <div className="form-grid">
            <label>
              Beschreibung oder Notiz <span className="optional">optional</span>
              <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={5000} rows={4} placeholder="Größe, Farbe oder ein kleiner Hinweis …" />
            </label>
            <div className="form-side-fields">
              <label>
                Link <span className="optional">optional</span>
                <input value={form.link} onChange={(event) => setForm({ ...form, link: event.target.value })} maxLength={2048} inputMode="url" placeholder="https://…" />
              </label>
              <label>
                Preis oder Preistext <span className="optional">optional</span>
                <input value={form.priceText} onChange={(event) => setForm({ ...form, priceText: event.target.value })} maxLength={200} placeholder="Zum Beispiel ca. 30 €" />
              </label>
            </div>
          </div>

          <fieldset className="group-picker">
            <legend>Wer darf den Wunsch sehen?</legend>
            <p className="hint">Keine Auswahl bedeutet privat. Du kannst denselben Wunsch mit mehreren Gruppen teilen.</p>
            {groups.length === 0 ? (
              <p className="inline-empty">Noch keine Gruppe vorhanden. <Link href="/groups">Jetzt eine Gruppe anlegen</Link></p>
            ) : (
              <div className="choice-grid">
                {groups.map((group) => (
                  <label className="checkbox-label" key={group.id}>
                    <input type="checkbox" checked={form.groupIds.includes(group.id)} onChange={(event) => toggleGroup(group.id, event.target.checked)} />
                    <span>{group.name}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="actions form-actions">
            <button type="submit" disabled={busy}>{busy ? "Wird gespeichert …" : editingId ? "Änderungen speichern" : "Wunsch speichern"}</button>
            <button className="secondary" type="button" onClick={cancelForm} disabled={busy}>Abbrechen</button>
          </div>
        </form>
      ) : null}

      {feedback ? (
        <p className={`notice notice-${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text}</p>
      ) : null}

      {loading ? (
        <div className="loading-grid" aria-label="Wunschliste wird geladen" aria-live="polite"><div className="skeleton-card tall" /><div className="skeleton-card tall" /></div>
      ) : wishes.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">♡</span>
          <h2>Dein erster Wunsch darf einziehen</h2>
          <p>Sammle etwas Kleines, etwas Großes oder einfach eine gute Idee. Du entscheidest, wer sie sehen kann.</p>
          <button type="button" onClick={startCreate}>Ersten Wunsch hinzufügen</button>
        </div>
      ) : (
        <div className="wish-grid">
          {wishes.map((wish) => (
            <article className="wish-card" key={wish.id}>
              <div className="wish-card-topline">
                <span className={`visibility-chip ${wish.groups.length === 0 ? "private" : "shared"}`}>
                  {wish.groups.length === 0 ? "Nur für dich" : wish.groups.length === 1 ? `Geteilt mit ${wish.groups[0].name}` : `Geteilt mit ${wish.groups.length} Gruppen`}
                </span>
                <button className="quiet-button" type="button" onClick={() => startEdit(wish)} disabled={busy}>Bearbeiten</button>
              </div>
              <h2>{wish.title}</h2>
              {wish.description ? <p className="wish-description">{wish.description}</p> : null}
              <div className="wish-meta-row">
                {wish.priceText ? <span className="price-pill">{wish.priceText}</span> : null}
                {wish.link ? <a className="external-link" href={wish.link} target="_blank" rel="noreferrer">Link öffnen <span aria-hidden="true">↗</span></a> : null}
              </div>
              {wish.groups.length > 1 ? <p className="group-detail">{wish.groups.map((group) => group.name).join(" · ")}</p> : null}
              {confirmDeleteId === wish.id ? (
                <div className="inline-confirm" role="alert">
                  <p>Wunsch wirklich löschen? Das lässt sich nicht rückgängig machen.</p>
                  <div className="actions compact-actions">
                    <button className="danger" type="button" onClick={() => void removeWish(wish)} disabled={deletingId === wish.id}>{deletingId === wish.id ? "Wird gelöscht …" : "Ja, löschen"}</button>
                    <button className="secondary" type="button" onClick={() => setConfirmDeleteId(undefined)} disabled={deletingId === wish.id}>Behalten</button>
                  </div>
                </div>
              ) : (
                <button className="text-button danger-text" type="button" onClick={() => setConfirmDeleteId(wish.id)}>Wunsch löschen</button>
              )}
            </article>
          ))}
        </div>
      )}

      {!loading && feedback?.tone === "error" ? <button className="text-button" type="button" onClick={() => { setLoading(true); setReloadKey((value) => value + 1); }}>Erneut laden</button> : null}
    </div>
  );
}
