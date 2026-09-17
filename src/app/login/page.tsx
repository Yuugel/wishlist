import Link from "next/link";
import { AuthShell } from "../components/app-shell";
import { LoginButton } from "../components/passkey-flows";
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
      description="Wähle einen Passkey auf diesem oder einem verbundenen Gerät. Ein Benutzername ist nicht nötig."
      footer={
        <p>
          Noch kein Konto? <Link href={signupHref}>Konto erstellen</Link>
          <br />
          Passkeys verloren? <Link href="/recover">Konto wiederherstellen</Link>
        </p>
      }
    >
      <LoginButton returnTo={returnTo} />
    </AuthShell>
  );
}
