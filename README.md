# Wishlist

Technische Grundlage für den Wishlist-MVP: Next.js mit App Router und
TypeScript, serverseitiges PostgreSQL über Drizzle ORM sowie eine minimale
PWA-Basis.

## Voraussetzungen

- Node.js `>=20.9.0`
- npm
- Für Datenbankbefehle eine PostgreSQL-Datenbank, zum Beispiel Neon

## Lokal starten

1. Abhängigkeiten installieren:

   ```bash
   npm install
   ```

2. Umgebungsvariablen anlegen. `.env.example` kopieren und den Platzhalter in
   `.env.local` durch eine lokale oder Neon-Verbindungszeichenkette ersetzen:

   ```bash
   cp .env.example .env.local
   ```

   Unter Windows PowerShell geht das zum Beispiel mit
   `Copy-Item .env.example .env.local`.

3. Entwicklungsserver starten:

   ```bash
   npm run dev
   ```

   Die Anwendung ist anschließend unter <http://localhost:3000> erreichbar.
   Der technische Health-Endpunkt liegt unter
   <http://localhost:3000/api/health> und liefert nur `{ "status": "ok" }`.

## Build und Produktion lokal prüfen

```bash
npm run typecheck
npm run lint
npm run build
npm start
```

`next.config.ts` enthält bewusst keine provider-spezifischen Einstellungen.
Vercel erkennt die Next.js-Anwendung automatisch; `DATABASE_URL` wird dort als
verschlüsselte Environment Variable hinterlegt.

## Drizzle und Migrationen

Die Drizzle-Konfiguration liegt in `drizzle.config.ts` und verwendet
`DATABASE_URL`. Das Schema liegt unter `src/server/db/schema.ts`; neben der
Auth-Grundlage enthält es die MVP-Tabellen für Gruppen, Mitgliedschaften und
Einladungen. Die serverseitige Gruppen-API und ihre Grenzen sind in
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
Hosting-Umgebung, niemals in Git.

## Struktur

- `src/app/` – App-Router-Seiten, Layout, Manifest und Route Handler
- `src/server/db/` – Node.js-only Datenbank-Client und Drizzle-Schema
- `src/server/groups/` – server-only Gruppen-Domain, Repository und Invite-Token
- `public/` – statische Assets, derzeit das Manifest-Icon
- `spikes/passkey-first-auth/` – isolierter Passkey-/Recovery-Spike; nicht Teil
  des Produktionscodes

Das Manifest und die Metadata bereiten eine spätere Installation vor. Offline-
Caching, Push und ein Service Worker sind in dieser Foundation bewusst nicht
enthalten. Die interaktive Passkey-/Login-UI und weitere fachliche Wishlist-
Funktionen folgen in separaten Tickets.
