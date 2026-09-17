import Link from "next/link";
import type { ReactNode } from "react";
import { AppNavigation } from "./app-navigation";

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg fill="none" viewBox="0 0 32 32">
        <path d="M16 26.5 6.8 17.4C1.4 12 5.2 5.7 10.3 5.7c2.7 0 4.6 1.5 5.7 3.4 1.2-1.9 3.1-3.4 5.7-3.4 5.1 0 8.9 6.3 3.5 11.7L16 26.5Z" />
        <path d="M21.8 4.2v4.2m2.1-2.1h-4.2" />
      </svg>
    </span>
  );
}

export function AppShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <Link className="brand" href="/wishlist" aria-label="Wishlist – Meine Wunschliste">
            <BrandMark />
            <span>Wishlist</span>
          </Link>
          <AppNavigation />
        </div>
      </header>
      <main className="app-main">
        <header className="page-heading">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {description ? <p className="page-description">{description}</p> : null}
        </header>
        {children}
      </main>
      <AppNavigation mobile />
    </div>
  );
}

export function AuthShell({
  eyebrow = "Deine Wünsche. Eure Vorfreude.",
  title,
  description,
  children,
  footer,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <div className="auth-brand-row">
        <Link className="brand" href="/" aria-label="Wishlist – Startseite">
          <BrandMark />
          <span>Wishlist</span>
        </Link>
      </div>
      <section className="auth-card">
        <div className="auth-heading">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="page-description">{description}</p>
        </div>
        {children}
        {footer ? <div className="auth-footer">{footer}</div> : null}
      </section>
      <p className="auth-aside">Privat, persönlich und ohne Wunschzettel-Chaos.</p>
    </main>
  );
}
