"use client";

import {
  startAuthentication,
  startRegistration,
  type StartAuthenticationOpts,
  type StartRegistrationOpts,
} from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { webAuthnErrorMessage } from "./webauthn-error";

type Ceremony<T> = { ceremonyId: string; options: T };
type ApiError = { message?: string };
type RecoveryResult = { ok: true; recoveryCode: string };

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
  return webAuthnErrorMessage(error);
}

function ensureWebAuthn(): void {
  if (!("PublicKeyCredential" in window) || !navigator.credentials) {
    throw new Error("Dieser Browser unterstützt Passkeys nicht.");
  }
}

function RecoveryCodeNotice(input: {
  recoveryCode: string;
  onContinue: () => void;
}) {
  return (
    <div className="recovery-notice">
      <span className="recovery-symbol" aria-hidden="true">✦</span>
      <h2>Dein Sicherheitscode</h2>
      <p className="notice notice-info" role="status">
        Speichere diesen neuen Recovery-Code jetzt sicher. Er wird nur dieses
        eine Mal vollständig angezeigt.
      </p>
      <code className="recovery-code">{input.recoveryCode}</code>
      <button type="button" onClick={input.onContinue}>
        Ich habe den Code sicher gespeichert
      </button>
    </div>
  );
}

export function PasswordSignupForm({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [recoveryCode, setRecoveryCode] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const result = await requestJson<RecoveryResult>(
        "/api/auth/password/signup",
        {
          displayName: form.get("displayName"),
          email: form.get("email"),
          password: form.get("password"),
        },
      );
      setRecoveryCode(result.recoveryCode);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Die Registrierung ist fehlgeschlagen.");
      setBusy(false);
    }
  }

  if (recoveryCode) {
    return (
      <RecoveryCodeNotice
        recoveryCode={recoveryCode}
        onContinue={() => {
          setRecoveryCode(undefined);
          router.replace(returnTo ?? "/account");
        }}
      />
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Anzeigename
        <input name="displayName" required maxLength={200} autoComplete="name" placeholder="Wie dürfen wir dich nennen?" />
      </label>
      <label>
        E-Mail
        <input name="email" type="email" required maxLength={320} autoComplete="email" placeholder="du@beispiel.de" />
      </label>
      <label>
        Passwort
        <input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
      </label>
      <p className="hint">Mindestens 12 Zeichen. Verwende ein einzigartiges Passwort.</p>
      <button type="submit" disabled={busy}>
        {busy ? "Konto wird erstellt …" : "Mit E-Mail und Passwort registrieren"}
      </button>
      {message && <p className="notice notice-error" role="alert">{message}</p>}
    </form>
  );
}

export function PasskeySignupForm({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [recoveryCode, setRecoveryCode] = useState<string>();

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
      const result = await requestJson<RecoveryResult>(
        "/api/auth/signup/verify",
        {
          ceremonyId: ceremony.ceremonyId,
          response,
        },
      );
      setRecoveryCode(result.recoveryCode);
    } catch (error) {
      setMessage(browserMessage(error));
      setBusy(false);
    }
  }

  if (recoveryCode) {
    return (
      <RecoveryCodeNotice
        recoveryCode={recoveryCode}
        onContinue={() => {
          setRecoveryCode(undefined);
          router.replace(returnTo ?? "/account");
        }}
      />
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Anzeigename
        <input name="displayName" required maxLength={200} autoComplete="name" placeholder="Wie dürfen wir dich nennen?" />
      </label>
      <label>
        E-Mail <span className="optional">(optional)</span>
        <input name="email" type="email" maxLength={320} autoComplete="email" placeholder="du@beispiel.de" />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Passkey wird eingerichtet …" : "Konto mit Passkey erstellen"}
      </button>
      {message && <p className="notice notice-error" role="alert">{message}</p>}
    </form>
  );
}

export function RecoveryForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [ceremony, setCeremony] = useState<
    Ceremony<StartRegistrationOpts["optionsJSON"]>
  >();
  const [recoveryCode, setRecoveryCode] = useState<string>();

  async function register(
    current: Ceremony<StartRegistrationOpts["optionsJSON"]>,
  ) {
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await startRegistration({
        optionsJSON: current.options,
      });
      const result = await requestJson<RecoveryResult>(
        "/api/auth/recovery/verify",
        { ceremonyId: current.ceremonyId, response },
      );
      setCeremony(undefined);
      setRecoveryCode(result.recoveryCode);
    } catch (error) {
      setMessage(browserMessage(error));
      setBusy(false);
    }
  }

  async function claim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      ensureWebAuthn();
      const current = await requestJson<
        Ceremony<StartRegistrationOpts["optionsJSON"]>
      >("/api/auth/recovery/options", {
        recoveryCode: form.get("recoveryCode"),
      });
      formElement.reset();
      setCeremony(current);
      await register(current);
    } catch (error) {
      setMessage(browserMessage(error));
      setBusy(false);
    }
  }

  if (recoveryCode) {
    return (
      <RecoveryCodeNotice
        recoveryCode={recoveryCode}
        onContinue={() => {
          setRecoveryCode(undefined);
          router.replace("/account");
        }}
      />
    );
  }

  if (ceremony) {
    return (
      <div className="auth-form">
        <button
          type="button"
          disabled={busy}
          onClick={() => void register(ceremony)}
        >
          {busy ? "Passkey wird registriert …" : "Passkey erneut registrieren"}
        </button>
        <p className="hint">
          Du kannst einen im Browser abgebrochenen Versuch innerhalb der kurzen
          Laufzeit erneut starten. Lade die Seite nicht neu.
        </p>
        {message && <p className="notice notice-error" role="alert">{message}</p>}
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={claim}>
      <label>
        Recovery-Code
        <input
          name="recoveryCode"
          required
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <p className="hint">
        Nach dem Fortfahren wird der Code exklusiv für diesen kurzlebigen
        Vorgang reserviert. Bei Ablauf wird er aus Sicherheitsgründen
        verbraucht. Prüfe vorher, dass dein Browser Passkeys unterstützt.
      </p>
      <button type="submit" disabled={busy}>
        {busy ? "Recovery-Code wird geprüft …" : "Neuen Passkey registrieren"}
      </button>
      {message && <p className="notice notice-error" role="alert">{message}</p>}
    </form>
  );
}

export function PasswordLoginForm({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await requestJson("/api/auth/password/login", {
        email: form.get("email"),
        password: form.get("password"),
      });
      router.push(returnTo ?? "/account");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Die Anmeldung ist fehlgeschlagen.");
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={login}>
      <label>
        E-Mail
        <input name="email" type="email" required maxLength={320} autoComplete="email" placeholder="du@beispiel.de" />
      </label>
      <label>
        Passwort
        <input name="password" type="password" required maxLength={128} autoComplete="current-password" />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Anmeldung wird geprüft …" : "Anmelden"}
      </button>
      {message && <p className="notice notice-error" role="alert">{message}</p>}
    </form>
  );
}

export function PasskeyLoginButton({ returnTo }: { returnTo?: string }) {
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
      router.push(returnTo ?? "/account");
    } catch (error) {
      setMessage(browserMessage(error));
      setBusy(false);
    }
  }

  return (
    <div className="auth-form">
      <button type="button" onClick={login} disabled={busy}>
        {busy ? "Passkey wird geprüft …" : "Mit Passkey anmelden"}
      </button>
      {message && <p className="notice notice-error" role="alert">{message}</p>}
    </div>
  );
}

type AccountSummary = {
  authenticated: true;
  displayName: string;
  email: string | null;
  hasPassword: boolean;
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

  async function addPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await requestJson("/api/auth/password", {
        password: form.get("password"),
      });
      formElement.reset();
      setAccount((current) => current ? { ...current, hasPassword: true } : current);
      setMessage("Das Passwort wurde sicher gespeichert.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Das Passwort konnte nicht gespeichert werden.");
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
    <div className="account-layout">
      <section className="profile-card">
        {account ? (
          <>
            <div className="profile-avatar" aria-hidden="true">{account.displayName.slice(0, 1).toLocaleUpperCase("de-DE")}</div>
            <div className="profile-copy">
              <p className="section-kicker">Angemeldet als</p>
              <h2>{account.displayName}</h2>
              <span className="security-badge">
                {account.hasPassword && account.passkeyCount > 0
                  ? "Passwort & Passkey"
                  : account.hasPassword ? "Passwort eingerichtet" : "Passkey-geschützt"}
              </span>
            </div>
          </>
        ) : (
          <div className="profile-loading" aria-label="Konto wird geladen" aria-live="polite"><span /><span /></div>
        )}
      </section>

      <div className="account-settings">
        {message ? <p className={`notice ${message.includes("gespeichert") ? "notice-success" : "notice-error"}`} role="status">{message}</p> : null}

        <section className="settings-card" aria-labelledby="passkeys-heading">
        <div className="settings-icon" aria-hidden="true">⌁</div>
        <div className="settings-copy">
          <div className="settings-heading-row">
            <div><p className="section-kicker">Sicher anmelden</p><h3 id="passkeys-heading">Deine Passkeys</h3></div>
            {account ? <span className="count-badge">{account.passkeyCount}</span> : null}
          </div>
          <p>Hinterlege einen weiteren Passkey für ein zusätzliches Gerät. So bleibt dein Konto leichter erreichbar.</p>
          <button type="button" onClick={addPasskey} disabled={busy || !account}>
            {busy ? "Passkey wird eingerichtet …" : "Weiteren Passkey hinzufügen"}
          </button>
          <p className="hint">Das Hinzufügen ist nur kurz nach einer Anmeldung möglich. Melde dich bei einer entsprechenden Aufforderung erneut an.</p>
        </div>
      </section>

      <section className="settings-card password-settings" aria-labelledby="password-heading">
        <div className="settings-icon" aria-hidden="true">••</div>
        <div className="settings-copy">
          <p className="section-kicker">Alternative Anmeldung</p>
          <h3 id="password-heading">E-Mail und Passwort</h3>
          {account?.hasPassword ? (
            <p>Für dieses Konto ist ein Passwort als zusätzlicher Login-Weg eingerichtet.</p>
          ) : account?.email ? (
            <form className="settings-form" onSubmit={addPassword}>
              <p>Richte für <strong>{account.email}</strong> ein Passwort als zusätzlichen Login-Weg ein.</p>
              <label>
                Neues Passwort
                <input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
              </label>
              <p className="hint">Mindestens 12 Zeichen. Dies ist nur kurz nach einer Anmeldung möglich.</p>
              <button type="submit" disabled={busy}>Passwort sicher einrichten</button>
            </form>
          ) : account ? (
            <p>Dieses Konto hat keine hinterlegte E-Mail-Adresse. Deshalb kann hier kein Passwort eingerichtet werden.</p>
          ) : (
            <p>Konto wird geladen …</p>
          )}
        </div>
      </section>

        <section className="settings-card quiet-settings" aria-labelledby="session-heading">
          <div className="settings-icon" aria-hidden="true">→</div>
          <div className="settings-copy">
            <p className="section-kicker">Dieses Gerät</p>
            <h3 id="session-heading">Aktuelle Sitzung</h3>
            <p>Beende die Anmeldung auf diesem Gerät, wenn du es nicht mehr verwendest.</p>
            <button className="secondary" type="button" onClick={logout} disabled={busy}>Abmelden</button>
          </div>
        </section>
      </div>
    </div>
  );
}
