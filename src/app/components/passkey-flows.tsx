"use client";

import {
  startAuthentication,
  startRegistration,
  type StartAuthenticationOpts,
  type StartRegistrationOpts,
} from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

type Ceremony<T> = { ceremonyId: string; options: T };
type ApiError = { message?: string };

async function requestJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok) {
    throw new Error(data.message || "Die Anfrage ist fehlgeschlagen.");
  }
  return data as T;
}

function browserMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Der Passkey-Vorgang wurde abgebrochen oder ist abgelaufen.";
    }
    if (error.name === "InvalidStateError") {
      return "Dieser Passkey ist für das Konto bereits registriert.";
    }
    return "Der Browser konnte den Passkey-Vorgang nicht abschließen.";
  }
  if (error instanceof Error) return error.message;
  return "Der Passkey-Vorgang ist fehlgeschlagen.";
}

function ensureWebAuthn(): void {
  if (!("PublicKeyCredential" in window) || !navigator.credentials) {
    throw new Error("Dieser Browser unterstützt Passkeys nicht.");
  }
}

export function SignupForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const form = new FormData(event.currentTarget);
    try {
      ensureWebAuthn();
      const ceremony = await requestJson<
        Ceremony<StartRegistrationOpts["optionsJSON"]>
      >("/api/auth/signup/options", {
        displayName: form.get("displayName"),
        email: form.get("email"),
      });
      const response = await startRegistration({ optionsJSON: ceremony.options });
      await requestJson("/api/auth/signup/verify", {
        ceremonyId: ceremony.ceremonyId,
        response,
      });
      router.push("/account");
    } catch (error) {
      setMessage(browserMessage(error));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label>
        Anzeigename
        <input name="displayName" required maxLength={200} autoComplete="name" />
      </label>
      <label>
        E-Mail <span className="optional">(optional)</span>
        <input name="email" type="email" maxLength={320} autoComplete="email" />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Passkey wird eingerichtet …" : "Konto mit Passkey erstellen"}
      </button>
      {message && <p className="notice" role="alert">{message}</p>}
    </form>
  );
}

export function LoginButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function login() {
    setBusy(true);
    setMessage(undefined);
    try {
      ensureWebAuthn();
      const ceremony = await requestJson<
        Ceremony<StartAuthenticationOpts["optionsJSON"]>
      >("/api/auth/login/options", {});
      const response = await startAuthentication({ optionsJSON: ceremony.options });
      await requestJson("/api/auth/login/verify", {
        ceremonyId: ceremony.ceremonyId,
        response,
      });
      router.push("/account");
    } catch (error) {
      setMessage(browserMessage(error));
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button type="button" onClick={login} disabled={busy}>
        {busy ? "Passkey wird geprüft …" : "Mit Passkey anmelden"}
      </button>
      {message && <p className="notice" role="alert">{message}</p>}
    </div>
  );
}

type AccountSummary = {
  authenticated: true;
  displayName: string;
  passkeyCount: number;
};

export function AccountPanel() {
  const router = useRouter();
  const [account, setAccount] = useState<AccountSummary>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    void fetch("/api/auth/session", { credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/login");
          return undefined;
        }
        if (!response.ok) throw new Error("Das Konto konnte nicht geladen werden.");
        return response.json() as Promise<AccountSummary>;
      })
      .then((value) => value && setAccount(value))
      .catch((error: unknown) => setMessage(browserMessage(error)));
  }, [router]);

  async function addPasskey() {
    setBusy(true);
    setMessage(undefined);
    try {
      ensureWebAuthn();
      const ceremony = await requestJson<
        Ceremony<StartRegistrationOpts["optionsJSON"]>
      >("/api/auth/passkeys/options", {});
      const response = await startRegistration({ optionsJSON: ceremony.options });
      await requestJson("/api/auth/passkeys/verify", {
        ceremonyId: ceremony.ceremonyId,
        response,
      });
      setAccount((current) => current
        ? { ...current, passkeyCount: current.passkeyCount + 1 }
        : current);
      setMessage("Der zusätzliche Passkey wurde gespeichert.");
    } catch (error) {
      setMessage(browserMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setMessage(undefined);
    try {
      await requestJson("/api/auth/logout", {});
      router.push("/login");
    } catch (error) {
      setMessage(browserMessage(error));
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="intro">
        {account
          ? <>Angemeldet als <strong>{account.displayName}</strong>. Registrierte Passkeys: {account.passkeyCount}.</>
          : "Konto wird geladen …"}
      </p>
      <button type="button" onClick={addPasskey} disabled={busy || !account}>
        Zusätzlichen Passkey registrieren
      </button>
      <button className="secondary" type="button" onClick={logout} disabled={busy}>
        Abmelden
      </button>
      <p className="hint">
        Das Hinzufügen ist nur kurz nach einer Anmeldung möglich. Melde dich bei
        entsprechender Aufforderung ab und erneut an.
      </p>
      {message && <p className="notice" role="status">{message}</p>}
    </div>
  );
}
