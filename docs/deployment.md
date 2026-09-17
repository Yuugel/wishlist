# Deployment auf Neon und Vercel

Dieses Runbook trennt die Repository-Vorbereitung von der externen
Provisionierung. Es enthält bewusst weder Projekt-IDs noch Domains oder Secrets.
Eine Produktionsdomain und damit die WebAuthn-RP-ID sind noch manuell
festzulegen. Bis dahin dürfen keine echten Nutzer-Passkeys angelegt werden.

## Zielbild und Branches

- Ein dediziertes Neon-Projekt enthält ausschließlich die Wishlist-Datenbank.
  Eine EU-Region, bevorzugt Frankfurt, wird nur gewählt, wenn Neon sie bei der
  Provisionierung tatsächlich anbietet.
- Ein eindeutig für `Yuugel/wishlist` vorgesehenes Vercel-Projekt ist mit dem
  Repository verbunden. `dev` erzeugt Integrations-/Preview-Deployments;
  `main` bleibt geschützter Release- und Production-Branch.
- Production- und Preview-Umgebungen verwenden getrennte Datenbanken und
  Secrets. Zufällige Preview-Deployments erhalten standardmäßig keine
  funktionsfähige Passkey-Konfiguration.
- Alle API Route Handler deklarieren die Node.js-Runtime. Die statischen
  App-Routen bleiben bei Next.js-Defaults.

Weder dieses Runbook noch ein Deployment-Auftrag ist eine Freigabe, `dev` oder
`main` zu mergen.

## Environment-Variablen

| Name | Geheim? | Verwendung |
|---|---:|---|
| `DATABASE_URL` | ja | PostgreSQL-/Neon-Verbindung mit TLS; pro Umgebung separat |
| `WEBAUTHN_RP_ID` | nein | stabile Domain ohne Scheme oder Port |
| `WEBAUTHN_ORIGIN` | nein | exakt ein erlaubter HTTPS-Origin ohne Pfad/abschließenden Slash |
| `WEBAUTHN_RP_NAME` | nein | angezeigter RP-Name; Standard `Wishlist` |
| `RECOVERY_CODE_PEPPERS` | ja | JSON-Objekt versionierter, unabhängig erzeugter Base64url-Pepper (mindestens 32 Byte je Wert) |
| `RECOVERY_CODE_ACTIVE_PEPPER_VERSION` | nein | positive aktive Versionsnummer aus `RECOVERY_CODE_PEPPERS` |
| `WEBAUTHN_PREVIEW_ENABLED` | nein | nur für bewusst eingerichtete Vercel-Previews exakt `true`; sonst weglassen/`false` |

`NODE_ENV` und `VERCEL_ENV` werden von der Laufzeit gesetzt und sollen nicht als
Anwendungssecrets gepflegt werden. Secret-Werte gehören in Neon/Vercel bzw. eine
lokale ignorierte `.env.local`, niemals in Git, Ausgaben oder Tickets.

### Environment-Scope

- **Lokal:** Die Werte aus `.env.example` dürfen mit `localhost` verwendet
  werden. Nur hier ist `http://localhost` zulässig.
- **Production:** `WEBAUTHN_RP_ID` und `WEBAUTHN_ORIGIN` müssen nach der
  Domainentscheidung explizit im Vercel-Production-Scope gesetzt werden. Bei
  fehlenden Werten, HTTP oder `localhost` bricht Auth fail-closed ab; es gibt
  keine Ableitung aus `Host`, `X-Forwarded-*` oder einer Vercel-URL.
- **Preview:** Standardmäßig keine WebAuthn-Werte und
  `WEBAUTHN_PREVIEW_ENABLED=false`. Falls Passkeys in Preview wirklich benötigt
  werden, ist zuerst eine feste kontrollierte Testdomain mit eigener RP-ID,
  eigener Datenbank und eigenen Peppers einzurichten; danach muss Preview
  explizit aktiviert werden. Keine Production-Credentials oder zufällige
  `*.vercel.app`-Deployment-URL wiederverwenden.

## Neon provisionieren und migrieren

1. Authentifiziert vorhandene Neon-Projekte prüfen. Nur ein bereits eindeutig
   Wishlist zugeordnetes Projekt verwenden; andernfalls ein dediziertes Projekt
   anlegen. Region und Projektname ohne Credentials im Betriebsinventar
   festhalten.
2. Eine eigene Rolle/Datenbank und eine TLS-geschützte Connection String
   erzeugen. Den Wert ausschließlich als `DATABASE_URL` im passenden
   Environment-Scope speichern.
3. Vor jeder Migration Zielprojekt, Branch, Datenbank und erwarteten leeren bzw.
   bekannten Zustand verifizieren. Bei unbekannter oder bestehender Datenbank
   stoppen, Backup/Neon-Branch erstellen und die SQL-History prüfen.
4. Aus einem sauberen Checkout genau die eingecheckte History anwenden:

   ```bash
   npm ci
   npm run db:migrate
   ```

   `drizzle/0000` bis `0005` bauen das MVP-Schema auf. `drizzle/0006` ersetzt
   einen Activity-Enum und Constraints und darf deshalb trotz erhaltener
   Anwendungsdaten nicht ungeprüft gegen eine unbekannte Bestandsdatenbank
   laufen. `npm run db:push` ist kein Production-Migrationsweg.
5. Erfolgreiche Migration, Umgebung und Zeitpunkt ohne Connection String
   protokollieren. Die Migration selbst belegt Connectivity; optional danach
   über einen sicheren SQL-Client `select 1` ausführen, ohne URL auszugeben.

## Vercel einrichten

1. Authentifiziert vorhandene Projekte prüfen und ausschließlich ein eindeutig
   Wishlist zugeordnetes Projekt mit `Yuugel/wishlist` verbinden.
2. `main` als Production-Branch und `dev` als Integrations-/Preview-Quelle
   konfigurieren. Keine automatische Branch-Integration durchführen.
3. Node.js gemäß `package.json` verwenden. Eine Vercel-Ausführungsregion nur
   anhand der aktuell angebotenen Projektkonfiguration datenbanknah wählen;
   keine Regionskennung raten. Alle Auth-/DB-API-Routen laufen explizit mit
   `runtime = "nodejs"`.
4. Variablen nach obigem Scope setzen. Secret-Werte weder mit `vercel env pull`
   in den Checkout übernehmen noch in Build-/Ticket-Ausgaben drucken.
5. Zuerst ohne echte Nutzer eine Preview validieren. Production erst nach
   Domain-/RP-ID-Entscheidung und expliziter Release-Freigabe ausrollen.

## Validierung und Healthcheck

Repository-seitig vor einem Deployment:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Nach einem realen Deployment (URL bewusst einsetzen, nicht aus Logs ableiten):

```bash
curl --fail --silent --show-error https://<deployment-host>/api/health
```

Erwartet werden HTTP `200` und `{"status":"ok"}`. Der Endpunkt ist ein
minimaler Liveness-Check und gibt weder Konfiguration noch Datenbankdetails aus.
Neon-Connectivity wird separat durch die Migration und einen authentifizierten
Anwendungsflow geprüft.

## Fehlerdiagnose

- **Build ohne `DATABASE_URL`:** Der Build darf wegen des lazy DB-Clients
  funktionieren; der erste DB-Zugriff schlägt absichtlich verständlich fehl.
  Environment-Scope und Variablenname prüfen, keinen Fake-Fallback ergänzen.
- **Auth meldet fehlende RP-Konfiguration:** Domainentscheidung und exakt
  gesetzte Production-Werte prüfen. Nicht den aktuellen Request-Host übernehmen.
- **Preview meldet deaktiviertes WebAuthn:** Das ist der sichere Standard. Nur
  nach Einrichtung der isolierten festen Testdomain explizit aktivieren.
- **Origin nicht erlaubt:** Scheme, Host und Port müssen exakt
  `WEBAUTHN_ORIGIN` entsprechen; Pfade und abschließende Slashes sind ungültig.
- **Recovery-Pepper fehlt:** Secret-JSON und aktive Version prüfen. Alte
  Pepper-Versionen behalten, solange Datenbankzeilen darauf verweisen.
- **DB-Verbindung scheitert:** Vercel-Scope, Neon-Rolle, TLS, IP-/Projektstatus
  und Region prüfen, ohne die Connection String auszugeben.
- **Migration scheitert:** Nicht wiederholt blind ausführen. Ziel und
  Drizzle-Journal prüfen und aus Backup/Neon-Branch untersuchen.

## Rollback

Bei einem reinen Anwendungsfehler auf das letzte bekannte Vercel-Deployment
zurückschalten. Datenbankänderungen nicht durch ad-hoc `DROP`, Down-Migrationen
oder Restore über eine laufende Datenbank rückgängig machen. Bei einer
DB-Inkompatibilität Schreibzugriffe stoppen, Neon-Backup/Branch sichern und eine
vorwärts gerichtete Korrekturmigration erstellen. Ein vollständiger Restore ist
nur nach expliziter Freigabe und mit zusammenpassenden Pepper-Versionen zulässig.

## Freigabe vor echten Nutzer-Passkeys

Alle Punkte müssen bewusst abgeschlossen und dokumentiert sein:

- dauerhaft kontrollierte Produktionsdomain ausgewählt und HTTPS aktiv;
- RP-ID und exakter Production-Origin festgelegt und im Production-Scope gesetzt;
- dedizierte Neon-Datenbank eindeutig identifiziert, gesichert und migriert;
- Production-Pepper erzeugt, versioniert und nur im Secret Manager gespeichert;
- Vercel-Projekt/Branches/Scopes geprüft und Production erfolgreich deployt;
- realer Healthcheck sowie ein isolierter Auth-/DB-Test erfolgreich;
- Backup-, Pepper-Retention- und Rollback-Verantwortung geklärt.
