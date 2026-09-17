import Link from "next/link";
import { RecoveryForm } from "../components/passkey-flows";

export default function RecoveryPage() {
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Wishlist</p>
        <h1>Konto wiederherstellen</h1>
        <p className="intro">
          Verwende deinen unabhängigen Recovery-Code, um einen neuen Passkey zu
          registrieren. Vor der erfolgreichen Registrierung entsteht keine
          Anmeldung.
        </p>
        <RecoveryForm />
        <p className="status">
          Passkey wieder verfügbar? <Link href="/login">Anmelden</Link>
        </p>
      </section>
    </main>
  );
}
