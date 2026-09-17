import Link from "next/link";

export default function Home() {
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Startnavigation">
        <Link className="landing-brand" href="/">Wishlist <span>♡</span></Link>
        <Link className="text-link" href="/login">Anmelden</Link>
      </nav>
      <section className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">Wünschen verbindet</p>
          <h1>Mehr Vorfreude.<br /><em>Weniger Verraten.</em></h1>
          <p className="landing-intro">
            Ein persönlicher Ort für deine Wünsche – und ein gemeinsamer Ort,
            an dem Schenken zur schönen Überraschung bleibt.
          </p>
          <div className="actions landing-actions">
            <Link className="button-link" href="/signup">Wunschliste starten</Link>
            <Link className="button-link secondary" href="/login">Ich habe schon ein Konto</Link>
          </div>
          <p className="privacy-note"><span aria-hidden="true">✦</span> Reservierungen bleiben für Wünschende unsichtbar.</p>
        </div>
        <div className="landing-visual" aria-hidden="true">
          <div className="floating-card floating-card-one">
            <span className="mini-icon coral">♡</span>
            <div><strong>Keramikkurs</strong><small>Für unseren Freundeskreis</small></div>
          </div>
          <div className="gift-orbit">
            <span className="orbit-heart">♡</span>
            <span className="orbit-spark">✦</span>
            <div className="gift-box"><span></span></div>
          </div>
          <div className="floating-card floating-card-two">
            <span className="mini-icon sage">✓</span>
            <div><strong>Gut aufgehoben</strong><small>Überraschung geschützt</small></div>
          </div>
        </div>
      </section>
    </main>
  );
}
