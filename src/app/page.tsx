import Link from "next/link";

export default function Home() {
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Wishlist MVP</p>
        <h1>Willkommen.</h1>
        <p className="intro">
          Erstelle ein passwortloses Konto oder melde dich direkt mit deinem
          Passkey an.
        </p>
        <div className="actions">
          <Link className="button-link" href="/signup">Konto erstellen</Link>
          <Link className="button-link secondary" href="/login">Anmelden</Link>
        </div>
      </section>
    </main>
  );
}
