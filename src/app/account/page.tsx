import Link from "next/link";
import { AccountPanel } from "../components/passkey-flows";

export default function AccountPage() {
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Wishlist</p>
        <h1>Dein Konto</h1>
        <AccountPanel />
        <div className="actions">
          <Link className="button-link" href="/wishlist">
            Meine Wunschliste
          </Link>
        </div>
      </section>
    </main>
  );
}
