import { AccountPanel } from "../components/passkey-flows";

export default function AccountPage() {
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Wishlist</p>
        <h1>Dein Konto</h1>
        <AccountPanel />
      </section>
    </main>
  );
}
