# ADR/Spike: Passkey-first-Authentifizierung und Recovery

- **Ticket:** GitHub-Issue #4
- **Status:** Entscheidungsvorlage; keine produktive Integration
- **Untersucht am:** 2026-09-16
- **Stack-Annahme:** Next.js + TypeScript + PostgreSQL + Drizzle

## Entscheidung in Kürze

**Der gewünschte Signup ist ohne E-Mail und Passwort technisch möglich.** Empfohlen
wird `@simplewebauthn/browser` + `@simplewebauthn/server` mit einem eigenen,
kleinen Account-, Ceremony-, Session- und Recovery-Layer. Für den späteren MVP
sollten `residentKey: "required"` (auffindbares Credential) und
`userVerification: "required"` gesetzt werden. Dadurch kann der Login nach dem
Logout ohne vorherige Eingabe eines Benutzernamens stattfinden.

`@simplewebauthn/server` 14.0.2 erzeugte im Spike aus einem undurchsichtigen
User-Handle und einem Anzeigenamen gültige Registrierungsoptionen, ohne ein
E-Mail- oder Passwortfeld zu kennen. Authentication-Optionen ohne
`allowCredentials` ermöglichen die Credential-Auswahl durch den Authenticator.
Mehrere Passkeys sind eine 1:n-Beziehung Account -> Credential; beim Hinzufügen
werden nur bereits vorhandene Credential-IDs in `excludeCredentials` übergeben.

**Nicht empfohlen für die erste Umsetzung:** Better Auth 1.7.5 unterstützt zwar
inzwischen Pre-Auth-Passkey-Registrierung und Sessions, verlangt im Core-Modell
aber weiterhin eine E-Mail als String. Ein erfundener E-Mail-Platzhalter würde
die optionale E-Mail fachlich und sicherheitstechnisch verfälschen. Auth.js führt
WebAuthn weiterhin als experimentell, dokumentiert dafür nur den Prisma-Adapter
und nutzt standardmäßig eine verpflichtende E-Mail.

## Ergebnis je Anforderung

| Anforderung | Ergebnis mit SimpleWebAuthn |
|---|---|
| Initialer Account nur mit Anzeigename + Passkey | **Ja.** Opaques, serverseitiges User-Handle; keine E-Mail/kein Passwort nötig. Account erst nach verifizierter Ceremony anlegen. |
| Login nach Logout ausschließlich per Passkey | **Ja.** Discoverable Credential und Authentication ohne `allowCredentials`; User Verification erzwingen. |
| Mehrere Passkeys | **Ja.** Beliebig viele Credential-Zeilen je Account; globale Eindeutigkeit der Credential-ID. |
| Optionale E-Mail | **Ja.** Nullable Profil-/Kontaktattribut, kein Auth-Identifier. |
| Recovery zu neuem Passkey | **Ja.** Recovery-Code claimen, eng begrenzte Recovery-Ceremony ausgeben, neuen Passkey verifizieren, erst dann reguläre Session erstellen. |
| Klartextfreie persistente Recovery | **Ja.** Nur öffentlicher Selector, HMAC-SHA-256-Digest, Pepper-Version und Status speichern. |
| Wiederverwendung verhindern | **Ja.** Atomarer Statuswechsel `active -> claimed -> consumed`; nur `active` darf geclaimt werden. |

## Geprüfte Optionen

### 1. SimpleWebAuthn 14.0.2 — Empfehlung

**Dafür**

- fokussierte, serverseitige WebAuthn-Verifikation statt eigener CBOR-/COSE- und
  Signaturimplementierung;
- Account-Identität, E-Mail-Optionalität und Recovery bleiben unter Kontrolle von
  Wishlist;
- API unterstützt opake `userID`-Bytes, Anzeigenamen, vorhandene Credentials,
  discoverable Login sowie Prüfung von Challenge, Origin, RP ID und User
  Verification;
- passt ohne Adapterzwang zu PostgreSQL/Drizzle.

**Dagegen**

- Account-Lifecycle, Challenge-Einmaligkeit, Session-Cookies, Rate Limits,
  Recovery und Autorisierungsprüfungen müssen selbst implementiert und auditiert
  werden;
- die Bibliothek ist kein vollständiges Auth-Framework.

### 2. Better Auth + Passkey 1.7.5 — funktional nah, derzeit nicht passend

Der Plugin-Code basiert auf SimpleWebAuthn. `registration.requireSession: false`,
`resolveUser`, `afterVerification` und `createSession` decken inzwischen einen
Pre-Auth-Flow ab; Listen/Löschen mehrerer Passkeys und Drizzle sind vorhanden.
Das wurde nicht nur aus Produkttexten abgeleitet: Repository-Tests erzeugen
Pre-Auth-Optionen ohne Session und testen das Anlegen nach erfolgreicher
Verifikation.

Blocker ist das Core-User-Schema: `email` ist weiterhin ein erforderlicher String
und das generierte PostgreSQL-/Drizzle-Schema setzt `email NOT NULL UNIQUE`. Im
Quelltext verweist ein TODO auf eine mögliche Änderung in v2. Die gezeigten
Pre-Auth-Tests erzeugen beim tatsächlichen User-Insert ebenfalls eine E-Mail.
Ein synthetischer Wert wie `<id>@invalid` ist keine saubere optionale E-Mail,
kann spätere Verifikation/Uniqueness beschädigen und wird daher verworfen.
Better Auth v2 kann vor dem Implementierungsticket neu bewertet werden.

### 3. Auth.js / NextAuth WebAuthn — nicht empfehlen

Die aktuelle Auth.js-Dokumentation kennzeichnet den Provider als experimentell
und nennt für WebAuthn nur den Prisma-Adapter. Der Default-Provider fordert eine
E-Mail an und verwendet sie als WebAuthn-User-Name. `getUserInfo` wäre zwar
anpassbar, aber experimenteller Provider, E-Mail-zentrierte Defaults und fehlende
dokumentierte Drizzle-Unterstützung ergeben für Wishlist keinen Vorteil gegenüber
SimpleWebAuthn.

### 4. WebAuthn komplett selbst verifizieren — verwerfen

Die Browser-API allein ist keine Server-Verifikation. Attestation/Assertion,
CBOR, COSE-Schlüssel, Signaturen, Flags, RP-ID-Hash und Counter selbst korrekt zu
prüfen wäre unnötig riskant. Der eigene Code soll nur Orchestrierung und
Persistenz übernehmen.

## Empfohlene Abläufe

### Signup

1. Anzeigenamen validieren; er ist **nicht eindeutig** und kein Login-Identifier.
2. Zufällige Account-ID und dauerhaftes 32-Byte-WebAuthn-User-Handle in einer
   kurzlebigen Signup-Ceremony vormerken. `user.name` ebenfalls opak halten;
   `user.displayName` ist der gewählte Anzeigename.
3. Registration Options mit stabiler RP ID, `residentKey: "required"`,
   `userVerification: "required"`, `attestation: "none"` und 5 Minuten Ablauf
   erzeugen. Challenge serverseitig an genau diese Ceremony binden.
4. Response serverseitig gegen **verbrauchte Challenge, erwartete Origin,
   erwartete RP ID und UV** verifizieren. Credential-ID global auf Eindeutigkeit
   prüfen.
5. In einer DB-Transaktion Account, Credential und Recovery-Digest anlegen. Den
   Recovery-Klartext genau in dieser HTTPS-Antwort einmal anzeigen und nie
   loggen. Danach Session rotieren/erstellen.

Schlägt die WebAuthn-Verifikation fehl, entsteht kein dauerhafter Account. Geht
die einmalige Recovery-Antwort verloren, kann ein noch angemeldeter Nutzer einen
neuen Code rotieren.

### Passkey-Login und weitere Passkeys

- Login-Optionen enthalten kein `allowCredentials`. Aus der Assertion wird die
  Credential-ID gelesen, die DB-Zeile geladen und anschließend mit öffentlichem
  Schlüssel, gespeichertem Counter, Challenge, Origin und RP ID verifiziert.
  `userHandle` muss zum Account passen. Den neuen Counter atomar aktualisieren.
- Einen weiteren Passkey nur aus einer frischen/erneut bestätigten Session oder
  einer Recovery-Ceremony registrieren. Dasselbe unveränderliche User-Handle und
  alle aktiven Credentials als `excludeCredentials` verwenden.
- Löschen/Umbenennen erfordert erneute User Verification. Nicht die letzte
  Zugriffsmöglichkeit löschen lassen, solange kein aktiver Recovery-Code
  bestätigt ist.

Synchronisierte Multi-Device-Passkeys können einen Counter von 0 liefern. Ein
Counter ist ein Signal, aber kein alleiniger Grund, einen ansonsten gültigen
Multi-Device-Passkey dauerhaft zu sperren; `deviceType` und `backedUp` speichern.

### Recovery

Empfohlenes Codeformat:

```text
wl1_<128-bit zufälliger Selector>.<256-bit zufälliges Secret>
```

Der Selector ist ein nicht geheimer Lookup-Schlüssel. Persistiert werden nur
`selector`, `HMAC-SHA-256(pepper, domain-separator || selector || secret)`,
`pepper_key_version`, Status und Zeitstempel. Der 256-Bit-Pepper liegt nur im
Secret Manager. Wegen 256 Bit zufälliger Code-Entropie ist ein langsamer
Passwort-KDF nicht nötig; HMAC schützt zusätzlich bei einem reinen DB-Abzug.
Ein kürzerer, menschengemachter Code wäre ein anderes Design und würde Argon2id,
viel strengere Limits und eine separate Bewertung erfordern.

Flow:

1. Vor Codeeingabe Browser-WebAuthn-Unterstützung prüfen. Versuche global, pro IP
   und pro Selector begrenzen; Antworten dürfen Account-Existenz nicht verraten.
2. Record über Selector laden, Digest mit dem zur Version gehörigen Pepper
   berechnen und mit konstantzeitlichem Vergleich prüfen.
3. In PostgreSQL atomar claimen, sinngemäß:

   ```sql
   UPDATE recovery_codes
      SET status = 'claimed', claimed_at = now(), claim_id = $claim_id
    WHERE id = $id AND status = 'active'
   RETURNING account_id;
   ```

   Genau ein konkurrierender Prozess erhält eine Zeile. Der vorangehende
   Digest-Vergleich bleibt erforderlich.
4. Nur ein kurzlebiges, HttpOnly gebundenes Recovery-Ceremony-Token ausgeben —
   **noch keine Account-Session**. Innerhalb dieser Ceremony begrenzte
   Wiederholungen einer neuen Registration erlauben.
5. Nach erfolgreicher WebAuthn-Verifikation in einer Transaktion neues Credential
   anlegen, alte Credentials für den Verlustfall widerrufen, Code auf `consumed`
   setzen, Recovery-Ceremony verbrauchen, vorhandene Sessions widerrufen und eine
   neue Session ausgeben. Einen neuen Recovery-Code einmalig anzeigen.

Ein geclaimter Code darf keine zweite Recovery-Ceremony öffnen. Läuft die
Ceremony aus, wird der Code sicherheitshalber verbraucht; die UI muss deshalb vor
dem Claim deutlich warnen. Ohne optionale E-Mail oder Support-Identitätsprüfung
ist ein verlorener Passkey **plus** verlorener/abgelaufener Recovery-Code absichtlich
nicht wiederherstellbar.

## PostgreSQL-/Drizzle-Modell auf hoher Ebene

| Tabelle | Wesentliche Felder/Constraints |
|---|---|
| `users` | `id uuid PK`, `webauthn_user_handle bytea UNIQUE NOT NULL` (unveränderlich), `display_name`, `email NULL`, `email_normalized NULL`, `email_verified_at NULL`, Status/Timestamps. Partieller Unique-Index auf normalisierte E-Mail, wenn nicht null. E-Mail nie für Passkey-Lookup verwenden. |
| `webauthn_credentials` | `id uuid PK`, `user_id FK`, `credential_id bytea UNIQUE`, `public_key bytea`, `counter bigint`, `transports text[]`, `device_type`, `backed_up`, `aaguid`, optionales Label, `created_at`, `last_used_at`, `revoked_at`; Index auf `user_id`. |
| `webauthn_ceremonies` | undurchsichtige ID bzw. Hash eines Ceremony-Tokens, Typ (`signup`, `authentication`, `add`, `recovery`), optionale User-/Recovery-FKs, Challenge oder Challenge-Digest, vorgemerktes User-Handle/Signup-Daten, `expires_at`, `consumed_at`, Versuchszähler. TTL-Bereinigung. |
| `sessions` | `id`, **Hash** eines zufälligen Session-Tokens (kein Klartexttoken), `user_id FK`, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at`, optional UA/IP-Metadaten. |
| `recovery_codes` | `id`, `user_id FK`, `selector UNIQUE`, `digest bytea`, `pepper_key_version`, Status (`active/claimed/consumed/revoked`), `claim_id`, `created/claimed/consumed_at`; höchstens ein aktiver Code je User. Niemals Klartext. |

Credential-ID und Public Key können alternativ kanonisch base64url-kodiert als
`text` gespeichert werden; `bytea` vermeidet Kodierungsvarianten. An den
SimpleWebAuthn-Grenzen explizit konvertieren. Drizzle-Migrationen müssen die
Unique-/Partial-Indizes und Status-Checks explizit enthalten. Counter- und
Credential-Update sowie Session-Erstellung gehören nach erfolgreicher Prüfung in
eine Transaktion.

## Session- und Endpoint-Sicherheit

- zufälliges opakes 256-Bit-Sessiontoken; nur dessen Digest in PostgreSQL;
- Cookie `__Host-wishlist-session`, `Secure`, `HttpOnly`, `SameSite=Lax`,
  `Path=/`, kein `Domain`; nach Signup/Login/Recovery rotieren;
- kurze Idle- und feste Absolute-Laufzeit, serverseitiger Widerruf;
- mutierende Endpoints nur POST, Origin-/CSRF-Prüfung, enge Content-Types und
  Rate Limits; Registrierung/Löschen mit frischer Authentifizierung;
- Challenge einmalig, zufällig, kurzlebig und an Ceremony-Typ/Account binden;
- Responses, Traces und Error-Reporting müssen Recovery-, Challenge-,
  Assertion- und Sessiondaten redigieren;
- XSS bleibt trotz phishing-resistenter Passkeys kritisch, weil es Sessions und
  Registrierungsaktionen missbrauchen kann. CSP, Output-Escaping und
  Dependency-Hygiene bleiben notwendig.

## RP ID, Origin und Hosting

- WebAuthn benötigt einen **Secure Context**: Produktion ausschließlich HTTPS.
  `http://localhost` ist die Entwicklungs-Ausnahme; LAN-IP/gewöhnliches HTTP ist
  keine portable Testumgebung.
- RP ID ist eine Domain ohne Scheme/Port, typischerweise `wishlist.example`.
  Origin ist exakt `https://wishlist.example` einschließlich Scheme und ggf.
  Port. Beides kommt aus validierter Konfiguration, niemals ungeprüft aus
  `Host`/`X-Forwarded-*`.
- Die RP ID früh auf einer dauerhaft kontrollierten Custom Domain festlegen.
  Credentials sind daran gebunden; ein späterer Domainwechsel erfordert im
  Regelfall erneute Registrierung. Nicht auf eine zufällige Provider-Domain
  festlegen.
- Zufällige Preview-Deployment-Origins passen schlecht zu einer stabilen RP ID.
  Dort Passkeys deaktivieren oder eine feste, kontrollierte Preview-Origin mit
  eigener Test-RP verwenden; keine Produktions-Credentials teilen.
- Next.js Route Handler für die Serverbibliothek im **Node.js-Runtime** betreiben
  (`@simplewebauthn/server` 14 verlangt Node >=20), nicht ungeprüft im Edge
  Runtime. App und Auth bevorzugt same-origin ausliefern.
- Load Balancer/CDN müssen HTTPS erzwingen. Mehrere Instanzen teilen PostgreSQL
  (und ggf. einen Rate-Limit-Store); keine Challenges/Sessions nur im
  Prozessspeicher.
- Recovery-Pepper und Session-Schlüssel gehören versioniert in einen Secret
  Manager. Backup/Restore muss DB und verfügbare Pepper-Versionen gemeinsam
  berücksichtigen. PostgreSQL braucht atomare Transaktionen und verlässliche
  Uhrzeit.

## Proof of Concept

Pfad: [`spikes/passkey-first-auth`](../../spikes/passkey-first-auth/README.md)

Der isolierte Spike enthält keine HTTP-/Next.js-Integration. Er prüft:

- Registrierungsoptionen ohne E-Mail/Passwort mit discoverable Credential und UV;
- weitere Credential-Optionen unter Ausschluss einer vorhandenen ID;
- username-losen Login nach Logout;
- 128-Bit-Selector + 256-Bit-Secret, HMAC-Persistenz, richtige/falsche
  Verifikation und einmaligen Consume-Zustand.

Ausgeführt mit Node 24.18.0 / npm 11.16.0:

```text
npm run check  -> erfolgreich (tsc --noEmit)
npm test       -> erfolgreich (7 Tests, 0 Fehler)
npm ci         -> erfolgreich; 0 bekannte npm-Audit-Funde
npm audit      -> 0 Schwachstellen
```

Unter Node 24 gab SimpleWebAuthn experimentelle Web-Crypto-/ML-DSA-Warnungen
aus; die Tests blieben erfolgreich. Das Implementierungsticket soll die gewählte
Produktions-Node-Version deshalb erneut prüfen und pinnen.

**Nicht ausgeführt/noch offen:** keine echte Browser-/Authenticator-Ceremony,
keine Chrome-WebAuthn-Emulation, kein Safari/iOS-/Android-/Windows-Test, keine
PostgreSQL-Race-/Drizzle-Migration, keine Next.js-Session-/Cookie-Integration,
kein Penetrationstest und kein Accessibility-/Recovery-UX-Test. Die vollständige
Assertion-/Attestation-Verifikation wurde nicht mit Hardware im Spike
nachgestellt; sie ist Aufgabe eines Implementierungstickets.

## Technische Evidenz (nicht nur Marketing)

Geprüft wurden veröffentlichte Paketmetadaten sowie versionierter Quellcode und
Tests:

- SimpleWebAuthn 14.0.2:
  [Registration Options](https://github.com/MasterKale/SimpleWebAuthn/blob/v14.0.2/packages/server/src/registration/generateRegistrationOptions.ts),
  [Registration-Verifikation](https://github.com/MasterKale/SimpleWebAuthn/blob/v14.0.2/packages/server/src/registration/verifyRegistrationResponse.ts),
  [Authentication Options](https://github.com/MasterKale/SimpleWebAuthn/blob/v14.0.2/packages/server/src/authentication/generateAuthenticationOptions.ts),
  [Authentication-Verifikation](https://github.com/MasterKale/SimpleWebAuthn/blob/v14.0.2/packages/server/src/authentication/verifyAuthenticationResponse.ts).
- Better Auth 1.7.5:
  [Plugin-Dokumentation](https://github.com/better-auth/better-auth/blob/v1.7.5/docs/content/docs/plugins/passkey.mdx),
  [Pre-Auth-E2E-Test](https://github.com/better-auth/better-auth/blob/v1.7.5/e2e/smoke/test/passkey-preauth.spec.ts),
  [Passkey-Tests](https://github.com/better-auth/better-auth/blob/v1.7.5/packages/passkey/src/passkey.test.ts),
  [erforderliche Core-E-Mail](https://github.com/better-auth/better-auth/blob/v1.7.5/packages/core/src/db/schema/user.ts),
  [generiertes PG-/Drizzle-Schema](https://github.com/better-auth/better-auth/blob/v1.7.5/packages/cli/test/__snapshots__/auth-schema-pg-passkey.txt).
- Auth.js Stand Commit `a1a16a5`:
  [WebAuthn-Dokumentation](https://github.com/nextauthjs/next-auth/blob/a1a16a5a7780488c7449feece410033f445d0b31/docs/pages/getting-started/authentication/webauthn.mdx),
  [Provider-Defaults/`getUserInfo`](https://github.com/nextauthjs/next-auth/blob/a1a16a5a7780488c7449feece410033f445d0b31/packages/core/src/providers/webauthn.ts).

## Vor dem Implementierungsticket zu entscheiden

1. endgültige Production- und Preview-Domains/RP IDs;
2. Policy für Widerruf alter Credentials bei Recovery (oben empfohlen: alle
   alten Credentials und Sessions widerrufen);
3. Idle-/Absolute-Sessiondauer und Recovery-Ceremony-TTL;
4. optionale E-Mail-Verifikation/Benachrichtigung, strikt getrennt vom Login;
5. Browser-/Authenticator-Supportmatrix und UX für nicht discoverable-fähige
   Security Keys;
6. unabhängiger Security Review des Ceremony-, Recovery- und Session-Codes.
