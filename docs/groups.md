# Gruppen-API (Ticket #9)

Die Gruppenlogik liegt serverseitig in `src/server/groups/`. Das Repository
prüft Mitgliedschaften und führt Änderungen in PostgreSQL-Transaktionen aus.
Es gibt bewusst keine Owner-/Admin- oder sonstige Rollen-Spalte.

## Authentifizierung

Die Route Handler verwenden ausschließlich die kanonische Session-Grundlage
aus #7 (`requireSession` und das HttpOnly-Cookie
`__Host-wishlist-session`). Es gibt keine parallele Session-Abstraktion und
keine Passkey-/Login-Logik in diesem Ticket.

## Endpunkte

Alle Endpunkte benötigen eine aktive Session:

- `GET /api/groups` – eigene Gruppen auflisten
- `POST /api/groups` mit `{ "name": "..." }` – Gruppe erstellen; der Ersteller
  wird als normales Mitglied angelegt
- `GET /api/groups/:groupId` – Gruppe und nur `id`/`displayName` der Mitglieder
- `GET /api/groups/:groupId/members` – die Mitgliederliste mit derselben
  serverseitigen Mitgliedschaftsprüfung
- `GET /api/groups/:groupId/wishes` – nach aktuellem Mitglied gruppierte
  Wünsche, die genau dieser Gruppe zugeordnet sind
- `POST /api/groups/:groupId/invites` – als Mitglied einen Invite erzeugen
- `POST /api/groups/join` mit `{ "token": "..." }` – Invite verwenden;
  wiederholte Requests desselben Nutzers sind idempotent
- `POST /api/groups/:groupId/leave` – ausschließlich die eigene
  Mitgliedschaft beenden; falls aktive Übernahmen ihre letzte gemeinsame
  Sichtbarkeit verlieren würden, antwortet der erste Request mit `409` und
  `requiresConfirmation: true`. Erst ein neuer Request mit
  `{ "confirmed": true }` führt den Austritt aus.

Die Lese-API für Gruppen verwendet eine gemeinsame serverseitige
Visibility-Schicht. Sie prüft die aktuelle Mitgliedschaft und filtert Wishes
über die konkrete `wish_groups`-Zuordnung; UI-Filter sind dafür nicht
maßgeblich. Private Wishes und Wishes anderer Gruppen werden nicht ausgeliefert.
Owner- und Viewer-Wishes werden in getrennten DTOs serialisiert. Die Owner-
Antwort enthält keine späteren Reservierungs-/Kaufinformationen; eine solche
Erweiterung ist ausschließlich für die Viewer-Form vorgesehen.

Invite-Tokens enthalten einen 128-Bit-Selector und ein 256-Bit-Geheimnis. In
der Datenbank stehen nur Selector und SHA-256-Digest. Ein Token ist sieben Tage
gültig und kann innerhalb dieser Zeit mehrfach verwendet werden.

## Lifecycle bei Sichtbarkeitsverlust

Eine Übernahme ist nur gültig, solange mindestens eine dem Wunsch zugeordnete
Gruppe existiert, in der Owner und Taker beide aktuell Mitglied sind. Diese
Prüfung wird aus dem Serverzustand berechnet; eine Client-Group-ID oder eine
Client-Liste betroffener Übernahmen ist kein Autorisierungsbeweis.

Der Leave-Preview verändert noch keine Daten. Der bestätigte Request ermittelt
den Zustand erneut. Membership-Änderung, gegebenenfalls Gruppenauflösung,
Auto-Release und Activity-Einträge liegen in derselben Transaktion. Geordnete
Group- und Wish-Row-Locks koordinieren dies mit Wish-Updates und
Takeover-Transitionen.

Sinkt eine Gruppe nach dem Austritt auf höchstens eine verbleibende Person,
werden Gruppe, Mitgliedschaften, Invites und Wish-Zuordnungen in derselben
Transaktion gelöscht. Die Wünsche selbst bleiben Eigentum ihrer Owner. Die
verbleibende Person erhält eine persistente Activity zur Auflösung.

Ein Lifecycle-Auto-Release entfernt sowohl `reserved`- als auch
`purchased`-Takeovers direkt, weil ohne gemeinsame Sichtbarkeit kein gültiger
Zwischenzustand existiert. Das ändert nicht die manuelle Taker-Regel
`purchased -> reserved -> available`. Owner-Antworten enthalten weder Status,
Taker, Anzahl betroffener Takeovers noch Hinweise auf Activity-Einträge.
