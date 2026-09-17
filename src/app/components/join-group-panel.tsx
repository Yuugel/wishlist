"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type JoinResponse = {
  joined?: boolean;
  group?: { id: string; name: string };
  message?: string;
  error?: string;
};

export function JoinGroupPanel({ token }: { token?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function joinGroup() {
    if (!token) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/groups/join", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await response.json().catch(() => ({}))) as JoinResponse;
      if (response.status === 401) {
        const returnTo = `/groups/join?token=${encodeURIComponent(token)}`;
        router.push(`/login?next=${encodeURIComponent(returnTo)}`);
        return;
      }
      if (!response.ok || !data.group) {
        throw new Error(
          data.error === "invalid_invite"
            ? "Dieser Einladungslink ist ungültig oder abgelaufen."
            : data.message || "Der Gruppe konnte nicht beigetreten werden.",
        );
      }
      router.replace(`/groups/${encodeURIComponent(data.group.id)}?joined=${data.joined ? "yes" : "already"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Der Gruppe konnte nicht beigetreten werden.");
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="empty-state compact-empty">
        <span className="empty-state-icon" aria-hidden="true">✦</span>
        <h2>Einladung nicht vollständig</h2>
        <p>In diesem Link fehlt der Einladungscode. Bitte lass dir einen neuen Link schicken.</p>
        <Link className="button-link secondary" href="/groups">Zu meinen Gruppen</Link>
      </div>
    );
  }

  return (
    <div className="join-card">
      <div className="join-illustration" aria-hidden="true">
        <span>♡</span><span>✦</span><span>♡</span>
      </div>
      <h2>Du wurdest eingeladen</h2>
      <p>Bestätige den Beitritt. Danach siehst du die Mitglieder und die für diese Gruppe geteilten Wünsche.</p>
      {message ? <p className="notice notice-error" role="alert">{message}</p> : null}
      <button type="button" onClick={() => void joinGroup()} disabled={busy}>
        {busy ? "Einladung wird geprüft …" : "Gruppe beitreten"}
      </button>
      <p className="hint">Falls nötig, wirst du zuerst sicher zur Anmeldung weitergeleitet.</p>
    </div>
  );
}
