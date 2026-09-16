export default function Home() {
  return (
    <main className="shell">
      <div className="card">
        <p className="eyebrow">Wishlist MVP</p>
        <h1>Technische Grundlage steht.</h1>
        <p className="intro">
          Next.js, TypeScript und die serverseitige Datenbank-Anbindung sind für
          die nächsten Umsetzungsschritte vorbereitet.
        </p>
        <p className="status">
          Health-Endpunkt: <a href="/api/health">/api/health</a>
        </p>
      </div>
    </main>
  );
}
