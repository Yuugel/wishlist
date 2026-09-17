import Link from "next/link";
import { SignupForm } from "../components/passkey-flows";

export default function SignupPage() {
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Wishlist</p>
        <h1>Konto erstellen</h1>
        <p className="intro">
          Du brauchst kein Passwort. Dein Anzeigename und ein Passkey genügen.
        </p>
        <SignupForm />
        <p className="status">Schon registriert? <Link href="/login">Anmelden</Link></p>
      </section>
    </main>
  );
}
