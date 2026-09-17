import Link from "next/link";
import { AuthShell } from "../components/app-shell";
import { RecoveryForm } from "../components/passkey-flows";

export default function RecoveryPage() {
  return (
    <AuthShell
      eyebrow="Sicher zurück"
      title="Konto wiederherstellen"
      description="Verwende deinen unabhängigen Recovery-Code, um einen neuen Passkey zu registrieren. Erst danach wirst du angemeldet."
      footer={<p>Passkey wieder verfügbar? <Link href="/login">Anmelden</Link></p>}
    >
      <RecoveryForm />
    </AuthShell>
  );
}
