import Link from "next/link";
import { AuthShell } from "../components/app-shell";
import {
  PasskeyLoginButton,
  PasswordLoginForm,
} from "../components/passkey-flows";
import { safeReturnPath } from "../safe-return-path";

type LoginPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const returnTo = safeReturnPath((await searchParams).next);
  const signupHref = returnTo
    ? `/signup?next=${encodeURIComponent(returnTo)}`
    : "/signup";

  return (
    <AuthShell
      title="Willkommen zurück"
      description="Melde dich einfach mit deiner E-Mail-Adresse und deinem Passwort an."
      footer={
        <p>
          Noch kein Konto? <Link href={signupHref}>Konto erstellen</Link>
          <br />
          Passkeys verloren? <Link href="/recover">Konto wiederherstellen</Link>
        </p>
      }
    >
      <PasswordLoginForm returnTo={returnTo} />
      <div className="auth-divider"><span>oder</span></div>
      <div className="auth-alternative">
        <p>Du nutzt bereits einen Passkey?</p>
        <PasskeyLoginButton returnTo={returnTo} />
      </div>
    </AuthShell>
  );
}
