import Link from "next/link";
import { AuthShell } from "../components/app-shell";
import {
  PasskeySignupForm,
  PasswordSignupForm,
} from "../components/passkey-flows";
import { safeReturnPath } from "../safe-return-path";

type SignupPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const returnTo = safeReturnPath((await searchParams).next);
  const loginHref = returnTo
    ? `/login?next=${encodeURIComponent(returnTo)}`
    : "/login";

  return (
    <AuthShell
      title="Dein Wunschraum wartet"
      description="Erstelle dein Konto mit Anzeigename, E-Mail-Adresse und einem sicheren Passwort."
      footer={<p>Schon registriert? <Link href={loginHref}>Anmelden</Link></p>}
    >
      <PasswordSignupForm returnTo={returnTo} />
      <div className="auth-divider"><span>oder</span></div>
      <details className="auth-alternative">
        <summary>Stattdessen mit Passkey registrieren</summary>
        <p>Passkeys bleiben eine sichere Alternative ohne Passwort.</p>
        <PasskeySignupForm returnTo={returnTo} />
      </details>
    </AuthShell>
  );
}
