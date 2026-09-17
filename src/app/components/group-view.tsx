"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type ApiMember = { id: string; displayName: string };
type ApiGroup = { id: string; name: string; createdAt: string; members: ApiMember[] };
type ApiWishFields = {
  id: string;
  title: string;
  description: string | null;
  link: string | null;
  priceText: string | null;
  createdAt: string;
  updatedAt: string;
};
type ViewerTakeoverStatus = "available" | "reserved_by_you" | "reserved" | "purchased_by_you" | "purchased";
type ApiWish =
  | (ApiWishFields & { view: "owner" })
  | (ApiWishFields & { view: "viewer"; takeoverStatus: ViewerTakeoverStatus });
type ApiMemberWishes = { member: ApiMember; wishes: ApiWish[] };
type ApiError = { message?: string; error?: string };
type Feedback = { tone: "success" | "error" | "info"; text: string };

function takeoverLabel(status: ViewerTakeoverStatus): string | null {
  switch (status) {
    case "available": return null;
    case "reserved_by_you": return "Von dir reserviert";
    case "reserved": return "Schon reserviert";
    case "purchased_by_you": return "Von dir gekauft";
    case "purchased": return "Bereits gekauft";
  }
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function GroupView({
  groupId,
  joinResult,
}: {
  groupId: string;
  joinResult?: "yes" | "already";
}) {
  const router = useRouter();
  const [group, setGroup] = useState<ApiGroup>();
  const [memberWishes, setMemberWishes] = useState<ApiMemberWishes[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | undefined>(() => joinResult
    ? { tone: "success", text: joinResult === "yes" ? "Willkommen in der Gruppe – du bist jetzt dabei." : "Du bist bereits Mitglied dieser Gruppe." }
    : undefined);
  const [busyWishId, setBusyWishId] = useState<string>();
  const [leaving, setLeaving] = useState(false);
  const [showLeavePanel, setShowLeavePanel] = useState(false);
  const [leaveNeedsConfirmation, setLeaveNeedsConfirmation] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [invite, setInvite] = useState<{ url: string; expiresAt: string }>();
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const encodedId = encodeURIComponent(groupId);
      const [groupResponse, wishesResponse] = await Promise.all([
        fetch(`/api/groups/${encodedId}`, { credentials: "same-origin", cache: "no-store", signal }),
        fetch(`/api/groups/${encodedId}/wishes`, { credentials: "same-origin", cache: "no-store", signal }),
      ]);
      const groupData = (await groupResponse.json().catch(() => ({}))) as ApiError & { group?: ApiGroup };
      const wishesData = (await wishesResponse.json().catch(() => ({}))) as ApiError & { members?: ApiMemberWishes[] };
      if (!groupResponse.ok || !wishesResponse.ok) {
        const response = !groupResponse.ok ? groupResponse : wishesResponse;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        throw new Error(groupData.message || wishesData.message || "Die Gruppe konnte nicht geladen werden.");
      }
      if (!groupData.group) throw new Error("Die Gruppendaten sind unvollständig.");
      setGroup(groupData.group);
      setMemberWishes(wishesData.members ?? []);
    } catch (error) {
      if (signal.aborted) return;
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Die Gruppe konnte nicht geladen werden." });
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [groupId, router]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, reloadKey]);

  async function mutateTakeover(wishId: string, method: "POST" | "PATCH" | "DELETE", status?: "reserved" | "purchased") {
    setBusyWishId(wishId);
    setFeedback(undefined);
    try {
      const response = await fetch(`/api/wishes/${encodeURIComponent(wishId)}/takeover`, {
        method,
        credentials: "same-origin",
        ...(status ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) } : {}),
      });
      const data = (await response.json().catch(() => ({}))) as ApiError & { takeoverStatus?: ViewerTakeoverStatus };
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok || !data.takeoverStatus) throw new Error(data.message ?? "Der Status konnte nicht geändert werden.");

      setMemberWishes((members) => members.map((entry) => ({
        ...entry,
        wishes: entry.wishes.map((wish) => wish.id === wishId && wish.view === "viewer"
          ? { ...wish, takeoverStatus: data.takeoverStatus! }
          : wish),
      })));
      const successText = data.takeoverStatus === "reserved_by_you"
        ? method === "POST" ? "Der Wunsch ist für dich reserviert." : "Der Wunsch steht wieder auf reserviert."
        : data.takeoverStatus === "purchased_by_you"
          ? "Als gekauft markiert."
          : "Die Reservierung wurde freigegeben.";
      setFeedback({ tone: "success", text: successText });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Der Status konnte nicht geändert werden." });
    } finally {
      setBusyWishId(undefined);
    }
  }

  async function createInvite() {
    setCreatingInvite(true);
    setFeedback(undefined);
    try {
      const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/invites`, { method: "POST", credentials: "same-origin" });
      const data = (await response.json().catch(() => ({}))) as ApiError & { token?: string; expiresAt?: string };
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok || !data.token || !data.expiresAt) throw new Error(data.message || "Der Einladungslink konnte nicht erstellt werden.");
      const url = `${window.location.origin}/groups/join?token=${encodeURIComponent(data.token)}`;
      setInvite({ url, expiresAt: data.expiresAt });
      setFeedback({ tone: "success", text: "Einladungslink erstellt. Er ist sieben Tage gültig." });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Der Einladungslink konnte nicht erstellt werden." });
    } finally {
      setCreatingInvite(false);
    }
  }

  async function copyInvite() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setFeedback({ tone: "success", text: "Einladungslink kopiert." });
    } catch {
      setFeedback({ tone: "info", text: "Kopieren war nicht möglich. Markiere den Link im Feld und kopiere ihn manuell." });
    }
  }

  async function leaveGroup(confirmed: boolean) {
    setLeaving(true);
    setFeedback(undefined);
    try {
      const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/leave`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiError & { requiresConfirmation?: boolean; dissolved?: boolean };
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 409 && data.requiresConfirmation) {
        setLeaveNeedsConfirmation(true);
        return;
      }
      if (!response.ok) throw new Error(data.message ?? "Die Gruppe konnte nicht verlassen werden.");
      router.push(`/groups?leave=${data.dissolved ? "dissolved" : "left"}`);
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Die Gruppe konnte nicht verlassen werden." });
    } finally {
      setLeaving(false);
    }
  }

  if (loading) {
    return <div className="content-stack" aria-label="Gruppe wird geladen" aria-live="polite"><div className="skeleton-hero" /><div className="loading-grid"><div className="skeleton-card tall" /><div className="skeleton-card tall" /></div></div>;
  }

  if (!group) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon" aria-hidden="true">!</span>
        <h2>Gruppe nicht erreichbar</h2>
        <p>{feedback?.text ?? "Die Gruppe konnte nicht geladen werden."}</p>
        <div className="actions"><button type="button" onClick={() => { setLoading(true); setReloadKey((value) => value + 1); }}>Erneut versuchen</button><Link className="button-link secondary" href="/groups">Zu meinen Gruppen</Link></div>
      </div>
    );
  }

  return (
    <div className="content-stack">
      <section className="group-hero">
        <div className="group-monogram" aria-hidden="true">{group.name.slice(0, 1).toLocaleUpperCase("de-DE")}</div>
        <div className="group-hero-copy">
          <p className="section-kicker">{group.members.length === 1 ? "1 Mitglied" : `${group.members.length} Mitglieder`}</p>
          <h2>{group.name}</h2>
          <p>Nur Wünsche, die mit dieser Gruppe geteilt wurden, erscheinen hier.</p>
        </div>
        <div className="group-hero-actions">
          <Link className="button-link" href={`/wishlist?groupId=${encodeURIComponent(groupId)}&new=1`}><span aria-hidden="true">＋</span> Wunsch für diese Gruppe</Link>
          <button className="secondary" type="button" onClick={() => void createInvite()} disabled={creatingInvite}>{creatingInvite ? "Link wird erstellt …" : "Menschen einladen"}</button>
        </div>
      </section>

      {feedback ? <p className={`notice notice-${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text}</p> : null}

      {invite ? (
        <section className="invite-panel" aria-labelledby="invite-heading">
          <div>
            <p className="section-kicker">Sicher teilen</p>
            <h3 id="invite-heading">Einladungslink</h3>
            <p>Gültig bis {formatExpiry(invite.expiresAt)}. Jede Person mit diesem Link kann der Gruppe beitreten.</p>
          </div>
          <div className="copy-row">
            <input aria-label="Einladungslink" readOnly value={invite.url} onFocus={(event) => event.currentTarget.select()} />
            <button type="button" onClick={() => void copyInvite()}>Link kopieren</button>
          </div>
        </section>
      ) : null}

      <section className="members-strip" aria-labelledby="members-heading">
        <div className="section-title-row"><div><p className="section-kicker">Eure Runde</p><h3 id="members-heading">Mitglieder</h3></div></div>
        <ul className="member-chips">
          {group.members.map((member, index) => (
            <li key={member.id}><span className={`member-avatar tone-${(index % 3) + 1}`} aria-hidden="true">{member.displayName.slice(0, 1).toLocaleUpperCase("de-DE")}</span>{member.displayName}</li>
          ))}
        </ul>
      </section>

      <section className="group-wishes-section" aria-labelledby="wishes-heading">
        <div className="section-title-row">
          <div><p className="section-kicker">Inspiration für euch</p><h3 id="wishes-heading">Wünsche in dieser Gruppe</h3></div>
        </div>
        <div className="member-wish-list">
          {memberWishes.map(({ member, wishes }, memberIndex) => (
            <article className="member-wishes" key={member.id}>
              <header className="member-wishes-heading">
                <span className={`member-avatar tone-${(memberIndex % 3) + 1}`} aria-hidden="true">{member.displayName.slice(0, 1).toLocaleUpperCase("de-DE")}</span>
                <div><h4>{member.displayName}</h4><p>{wishes.length === 1 ? "1 geteilter Wunsch" : `${wishes.length} geteilte Wünsche`}</p></div>
              </header>
              {wishes.length === 0 ? (
                <p className="member-empty">Noch keine sichtbaren Wünsche.</p>
              ) : (
                <div className="group-wish-grid">
                  {wishes.map((wish) => {
                    const busy = busyWishId === wish.id;
                    const status = wish.view === "viewer" ? wish.takeoverStatus : undefined;
                    const label = status ? takeoverLabel(status) : null;
                    return (
                      <div className="group-wish-card" key={wish.id}>
                        <div className="wish-card-topline">
                          {wish.view === "owner" ? <span className="visibility-chip private">Dein Wunsch</span> : label ? <span className={`status-chip status-${status}`}>{label}</span> : <span className="visibility-chip available">Noch verfügbar</span>}
                        </div>
                        <h5>{wish.title}</h5>
                        {wish.description ? <p className="wish-description">{wish.description}</p> : null}
                        <div className="wish-meta-row">
                          {wish.priceText ? <span className="price-pill">{wish.priceText}</span> : null}
                          {wish.link ? <a className="external-link" href={wish.link} target="_blank" rel="noreferrer">Link öffnen <span aria-hidden="true">↗</span></a> : null}
                        </div>
                        {status === "available" ? <button type="button" disabled={busy} onClick={() => void mutateTakeover(wish.id, "POST")}>{busy ? "Wird reserviert …" : "Für mich reservieren"}</button> : null}
                        {status === "reserved_by_you" ? <div className="actions compact-actions"><button type="button" disabled={busy} onClick={() => void mutateTakeover(wish.id, "PATCH", "purchased")}>Als gekauft markieren</button><button className="secondary" type="button" disabled={busy} onClick={() => void mutateTakeover(wish.id, "DELETE")}>Freigeben</button></div> : null}
                        {status === "purchased_by_you" ? <button className="secondary" type="button" disabled={busy} onClick={() => void mutateTakeover(wish.id, "PATCH", "reserved")}>Zurück auf reserviert</button> : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="leave-zone">
        {!showLeavePanel ? <button className="text-button danger-text" type="button" onClick={() => setShowLeavePanel(true)}>Gruppe verlassen</button> : (
          <div className="inline-confirm" role="alert">
            <h3>{leaveNeedsConfirmation ? "Aktive Reservierungen betroffen" : "Gruppe wirklich verlassen?"}</h3>
            <p>{leaveNeedsConfirmation
              ? "Durch deinen Austritt verlieren aktive Übernahmen ihre letzte gemeinsame Sichtbarkeit und werden automatisch freigegeben."
              : "Du verlierst den Zugriff auf die Wünsche dieser Gruppe. Bleibt nur eine Person übrig, wird die Gruppe automatisch aufgelöst."}</p>
            <div className="actions compact-actions">
              <button className="danger" type="button" disabled={leaving} onClick={() => void leaveGroup(leaveNeedsConfirmation)}>{leaving ? "Gruppe wird verlassen …" : leaveNeedsConfirmation ? "Trotzdem verlassen" : "Gruppe verlassen"}</button>
              <button className="secondary" type="button" disabled={leaving} onClick={() => { setShowLeavePanel(false); setLeaveNeedsConfirmation(false); }}>Abbrechen</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
