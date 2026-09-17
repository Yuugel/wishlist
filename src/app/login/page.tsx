import Link from "next/link";
import { LoginButton } from "../components/passkey-flows";

export default function LoginPage() {
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Wishlist</p>
        <h1>Anmelden</h1>
        <p className="intro">
          Wähle einen Passkey auf diesem Gerät oder einem verbundenen Gerät aus.
          Ein Benutzername ist nicht erforderlich.
        </p>
        <LoginButton />
        <p className="status">
          Noch kein Konto? <Link href="/signup">Konto erstellen</Link>
          <br />
          Passkeys verloren? <Link href="/recover">Konto wiederherstellen</Link>
        </p>
      </section>
    </main>
  );
}
