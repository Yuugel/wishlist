# Gruppen-API (Ticket #9)

Die Gruppenlogik liegt serverseitig in `src/server/groups/`. Das Repository
prüft Mitgliedschaften und führt Änderungen in PostgreSQL-Transaktionen aus.
Es gibt bewusst keine Owner-/Admin- oder sonstige Rollen-Spalte.

## Authentifizierung

Die Route Handler verwenden ausschließlich die vorhandene Session-Grundlage
und das in der Auth-Entscheidung festgelegte HttpOnly-Cookie
`__Host-wishlist-session`. Eine Login- oder Passkey-UI ist in diesem Ticket
nicht enthalten.

## Endpunkte

Alle Endpunkte benötigen eine aktive Session:

- `GET /api/groups` – eigene Gruppen auflisten
- `POST /api/groups` mit `{ "name": "..." }` – Gruppe erstellen; der Ersteller
  wird als normales Mitglied angelegt
- `GET /api/groups/:groupId` – Gruppe und nur `id`/`displayName` der Mitglieder
- `POST /api/groups/:groupId/invites` – als Mitglied einen Invite erzeugen
- `POST /api/groups/join` mit `{ "token": "..." }` – Invite verwenden;
  wiederholte Requests desselben Nutzers sind idempotent
- `POST /api/groups/:groupId/leave` – ausschließlich die eigene
  Mitgliedschaft beenden

Invite-Tokens enthalten einen 128-Bit-Selector und ein 256-Bit-Geheimnis. In
der Datenbank stehen nur Selector und SHA-256-Digest. Ein Token ist sieben Tage
gültig und kann innerhalb dieser Zeit mehrfach verwendet werden.

Sinkt eine Gruppe nach dem Austritt auf höchstens eine verbleibende Person,
werden Gruppe, Mitgliedschaften und Invites in derselben Transaktion gelöscht.
`createGroupService` bietet dafür den Post-Commit-Hook `onGroupDissolved` an;
ein Activity-/Notification-System oder Wish-Tabellen werden hier nicht
vorgezogen.
