"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

type ApiGroup = {
  id: string;
  name: string;
  createdAt: string;
};

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

type WishForm = {
  title: string;
  description: string;
  link: string;
  priceText: string;
  groupIds: string[];
};

type ApiError = {
  message?: string;
};

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok) {
    throw new ApiRequestError(
      data.message || "Die Anfrage ist fehlgeschlagen.",
      response.status,
    );
  }
  return data as T;
}

function emptyForm(initialGroupId?: string): WishForm {
  return {
    title: "",
    description: "",
    link: "",
    priceText: "",
    groupIds: initialGroupId ? [initialGroupId] : [],
  };
}

export function WishlistPanel({ initialGroupId }: { initialGroupId?: string }) {
  const router = useRouter();
  const [wishes, setWishes] = useState<ApiWish[]>([]);
  const [groups, setGroups] = useState<ApiGroup[]>([]);
  const [form, setForm] = useState<WishForm>(() => emptyForm(initialGroupId));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [wishResult, groupResult] = await Promise.all([
          requestJson<{ wishes: ApiWish[] }>("/api/wishes"),
          requestJson<{ groups: ApiGroup[] }>("/api/groups"),
        ]);
        if (cancelled) return;
        setWishes(wishResult.wishes);
        setGroups(groupResult.groups);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.status === 401) {
          router.replace("/login");
          return;
        }
        setMessage(
          error instanceof Error
            ? error.message
            : "Die Wunschliste konnte nicht geladen werden.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function startCreate() {
    const selectedContextGroup =
      initialGroupId && groups.some((group) => group.id === initialGroupId)
        ? initialGroupId
        : undefined;
    setEditingId(null);
    setForm(emptyForm(selectedContextGroup));
    setShowForm(true);
    setMessage(undefined);
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
    setMessage(undefined);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
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
    setMessage(undefined);

    try {
      const body = {
        title: form.title,
        description: form.description,
        link: form.link,
        priceText: form.priceText,
        groupIds: form.groupIds,
      };
      const result = editingId
        ? await requestJson<{ wish: ApiWish; changes?: { isNoop: boolean } }>(
            `/api/wishes/${editingId}`,
            { method: "PATCH", body: JSON.stringify(body) },
          )
        : await requestJson<{ wish: ApiWish; changes?: { isNoop: boolean } }>(
            "/api/wishes",
            {
              method: "POST",
              body: JSON.stringify(body),
            },
          );

      setWishes((current) => {
        if (!editingId) return [result.wish, ...current];
        return current.map((wish) =>
          wish.id === result.wish.id ? result.wish : wish,
        );
      });
      setShowForm(false);
      setEditingId(null);
      setMessage(
        result.changes?.isNoop
          ? "Keine Änderungen gespeichert."
          : "Wunsch gespeichert.",
      );
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        router.replace("/login");
        return;
      }
      setMessage(
        error instanceof Error ? error.message : "Der Wunsch konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeWish(wish: ApiWish) {
    if (!window.confirm(`Wunsch „${wish.title}“ wirklich löschen?`)) return;
    setDeletingId(wish.id);
    setMessage(undefined);
    try {
      await requestJson(`/api/wishes/${wish.id}`, { method: "DELETE" });
      setWishes((current) => current.filter((item) => item.id !== wish.id));
      if (editingId === wish.id) cancelForm();
      setMessage("Wunsch gelöscht.");
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        router.replace("/login");
        return;
      }
      setMessage(
        error instanceof Error ? error.message : "Der Wunsch konnte nicht gelöscht werden",
      );
    } finally {
      setDeletingId(undefined);
    }
  }

  return (
    <div className="stack">
      <div className="actions">
        <button type="button" onClick={startCreate} disabled={busy || loading}>
          Wunsch anlegen
        </button>
        <Link className="button-link secondary" href="/account">
          Konto
        </Link>
      </div>

      {message && <p className="notice" role="status">{message}</p>}

      {showForm && (
        <form className="wish-form" onSubmit={submit}>
          <h2>{editingId ? "Wunsch bearbeiten" : "Neuer Wunsch"}</h2>
          <label>
            Titel
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              required
              maxLength={200}
            />
          </label>
          <label>
            Beschreibung/Notiz <span className="optional">(optional)</span>
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
              maxLength={5000}
              rows={3}
            />
          </label>
          <label>
            Link <span className="optional">(optional)</span>
            <input
              value={form.link}
              onChange={(event) => setForm({ ...form, link: event.target.value })}
              maxLength={2048}
              inputMode="url"
            />
          </label>
          <label>
            Preis/Preistext <span className="optional">(optional)</span>
            <input
              value={form.priceText}
              onChange={(event) =>
                setForm({ ...form, priceText: event.target.value })
              }
              maxLength={200}
            />
          </label>

          <fieldset className="group-picker">
            <legend>Gruppenzuordnung</legend>
            <p className="hint">
              Keine Auswahl bedeutet privat. Mehrere Gruppen sind möglich.
            </p>
            {groups.length === 0 ? (
              <p className="hint">Du bist aktuell in keiner Gruppe.</p>
            ) : (
              groups.map((group) => (
                <label className="checkbox-label" key={group.id}>
                  <input
                    type="checkbox"
                    checked={form.groupIds.includes(group.id)}
                    onChange={(event) =>
                      toggleGroup(group.id, event.target.checked)
                    }
                  />
                  {group.name}
                </label>
              ))
            )}
          </fieldset>

          <div className="actions">
            <button type="submit" disabled={busy}>
              {busy ? "Speichern …" : "Speichern"}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={cancelForm}
              disabled={busy}
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="intro">Wunschliste wird geladen …</p>
      ) : wishes.length === 0 ? (
        <p className="intro">Noch keine Wünsche. Private Wünsche bleiben nur für dich sichtbar.</p>
      ) : (
        <div className="wish-list">
          {wishes.map((wish) => (
            <article className="wish-item" key={wish.id}>
              <div className="wish-item-heading">
                <h2>{wish.title}</h2>
                <div className="actions compact-actions">
                  <button type="button" onClick={() => startEdit(wish)} disabled={busy}>
                    Bearbeiten
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => void removeWish(wish)}
                    disabled={busy || deletingId === wish.id}
                  >
                    {deletingId === wish.id ? "Löschen …" : "Löschen"}
                  </button>
                </div>
              </div>
              {wish.description && <p>{wish.description}</p>}
              {wish.link && (
                <p>
                  <a href={wish.link} target="_blank" rel="noreferrer">
                    Link öffnen
                  </a>
                </p>
              )}
              {wish.priceText && <p className="wish-price">{wish.priceText}</p>}
              <p className="wish-groups">
                {wish.groups.length === 0
                  ? "Privat"
                  : wish.groups.map((group) => group.name).join(", ")}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
