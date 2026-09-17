import Link from "next/link";
import { AuthShell } from "../components/app-shell";
import { SignupForm } from "../components/passkey-flows";
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
      description="Kein Passwort, kein Pflicht-Postfach. Dein Anzeigename und ein sicherer Passkey genügen."
      footer={<p>Schon registriert? <Link href={loginHref}>Anmelden</Link></p>}
    >
      <SignupForm returnTo={returnTo} />
    </AuthShell>
  );
}
