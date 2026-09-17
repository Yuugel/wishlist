# Wishlist

Technische Grundlage für den Wishlist-MVP: Next.js mit App Router und
TypeScript, serverseitiges PostgreSQL über Drizzle ORM sowie eine minimale
PWA-Basis.

## Voraussetzungen

- Node.js `>=20.9.0`
- npm
- Für Datenbankbefehle eine PostgreSQL-Datenbank, zum Beispiel Neon

## Lokal starten

1. Abhängigkeiten reproduzierbar installieren:

   ```bash
   npm ci
   ```

2. Umgebungsvariablen anlegen. `.env.example` kopieren und den Platzhalter in
   `.env.local` durch eine lokale oder Neon-Verbindungszeichenkette ersetzen:

   ```bash
   cp .env.example .env.local
   ```

   Unter Windows PowerShell geht das zum Beispiel mit
   `Copy-Item .env.example .env.local`. Für Passkeys sind außerdem
   `WEBAUTHN_RP_ID` (Hostname ohne Scheme/Port) und `WEBAUTHN_ORIGIN` (exakter
   Origin) gesetzt. Die dokumentierten localhost-Werte gelten nur lokal;
   Produktion benötigt eine stabile HTTPS-Domain.

3. Entwicklungsserver starten:

   ```bash
   npm run dev
   ```

   Die Anwendung ist anschließend unter <http://localhost:3000> erreichbar.
   Der technische Health-Endpunkt liegt unter
   <http://localhost:3000/api/health> und liefert nur `{ "status": "ok" }`.
   Unter <http://localhost:3000/signup> kann ein Konto regulär mit Anzeigename,
   E-Mail und Passwort oder alternativ mit Passkey erstellt werden;
   <http://localhost:3000/login> bietet beide Login-Wege. Passwörter werden mit
   parameterisiertem scrypt und individuellem Salt abgeleitet. Der bei der
   Erstellung einmalig angezeigte Recovery-Code kann unter
   <http://localhost:3000/recover> zum sicheren Ersatz
   verlorener Passkeys verwendet werden. Unter `/activity` stehen außerdem die
  persistenten In-App-Hinweise zu Änderungen an übernommenen Wünschen; die
  Liste ist nur über `GET /api/activity` mit der eigenen Session abrufbar.

## Build und Produktion lokal prüfen

```bash
npm run typecheck
npm run lint
npm run build
npm start
```

`next.config.ts` enthält bewusst keine provider-spezifischen Einstellungen.
Vercel erkennt die Next.js-Anwendung automatisch. Alle API-Routen deklarieren
für Auth, Datenbank und Health explizit die Node.js-Runtime. Die vollständigen
Environment-Scope-, Neon-, Migrations-, WebAuthn- und Rollback-Schritte stehen
im [Deployment-Runbook](docs/deployment.md). Insbesondere werden
`DATABASE_URL` und Recovery-Pepper nur als Provider-Secrets hinterlegt.

Solange keine dauerhaft kontrollierte Produktionsdomain mit exakter RP-ID und
Origin festgelegt ist, ist Production-Passkey-Nutzung nicht freigegeben.
Vercel-Previews bleiben standardmäßig fail-closed und dürfen keine zufällige
Deployment-URL als dauerhafte RP-ID verwenden.

## Drizzle und Migrationen

Die Drizzle-Konfiguration liegt in `drizzle.config.ts` und verwendet
`DATABASE_URL`. Das Schema liegt unter `src/server/db/schema.ts`; neben der
Auth-Grundlage enthält es die MVP-Tabellen für Gruppen, Mitgliedschaften,
Einladungen, Wishes, Takeovers und persistente Activity-Einträge. Die
serverseitige Gruppen-API und ihre Grenzen sind in
`docs/groups.md` dokumentiert.

```bash
# Aus dem Schema eine Migration erzeugen
npm run db:generate

# Vorhandene Migrationen gegen DATABASE_URL ausführen
npm run db:migrate

# Nur für lokale Entwicklung: Schema direkt anwenden
npm run db:push
```

`db:migrate` und `db:push` benötigen eine echte, nicht eingecheckte
`DATABASE_URL`. Zugangsdaten gehören ausschließlich in `.env.local` oder die
Hosting-Umgebung, niemals in Git. Migration `0007` ergänzt ausschließlich die
optionale Tabelle `password_credentials`; bestehende Passkey-Konten bleiben
unverändert. Die Migration wird vor einem Deployment bewusst nach Backup- und
Zielprüfung ausgeführt, nicht automatisch bei Build oder Entwicklung.

## Struktur

- `src/app/` – App-Router-Seiten, Layout, Manifest und Route Handler
- `src/server/db/` – Node.js-only Datenbank-Client und Drizzle-Schema
- `src/server/auth/` – serverseitige Passwort-, Passkey-, Recovery-, Ceremony- und Sessionlogik
- `src/server/groups/` – server-only Gruppen-Domain, Repository und Invite-Token
- `src/server/visibility/` – gemeinsame serverseitige Gruppen-/Wish-Sichtbarkeit
- `src/server/activity/` – server-only Activity-Liste und Wish-Change-Events
- `public/` – statische Assets, derzeit das Manifest-Icon
- `spikes/passkey-first-auth/` – isolierter Passkey-/Recovery-Spike; nicht Teil
  des Produktionscodes

Das Manifest und die Metadata bereiten eine spätere Installation vor. Offline-
Caching, Push und ein Service Worker sind bewusst nicht enthalten. Die
Recovery-Semantik einschließlich Abbruch, Ablauf und Credential-Widerruf ist in
[`docs/recovery.md`](docs/recovery.md) dokumentiert.
