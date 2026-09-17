# Recovery mit neuem Passkey

Der Recovery-Flow folgt ADR 0001 und verwendet ausschließlich Codes im Format
`wl1_<selector>.<secret>`. In PostgreSQL liegen nur Selector, versionierter
HMAC-SHA-256-Digest und Status; der Klartext wird weder persistiert noch geloggt.

## Ablauf und Sicherheitsgrenzen

1. `POST /api/auth/recovery/options` wendet globale, proxy-IP- und
   selectorbezogene Limits an. Lookup-, Format-, Status- und Digestfehler liefern
   dieselbe nicht-enumerierende Antwort.
2. Ein korrekter Code wird mit einem bedingten Update genau einmal von `active`
   nach `claimed` überführt. Das Anlegen der an Nutzer und Code gebundenen
   Recovery-Ceremony geschieht in derselben Transaktion. Der zufällige Claim ist
   nur als kurzlebiges `HttpOnly`-/`Secure`-/`SameSite=Strict`-Cookie verfügbar;
   es entsteht keine normale Session.
3. Die Registration nutzt dieselbe SimpleWebAuthn-Konfiguration wie Signup und
   zusätzliche Passkeys. Challenge, exakter Origin, RP-ID und User Verification
   werden serverseitig geprüft. Die Recovery-Ceremony akzeptiert ausschließlich
   eine Registration, ist fünf Minuten gültig und auf fünf Fehlversuche begrenzt.
4. Erst nach vollständiger Verifikation werden in einer Transaktion alle bisher
   aktiven Credentials als verloren widerrufen, das neue Credential gespeichert,
   Ceremony und alter Code konsumiert, alle alten Sessions widerrufen, eine neue
   Session erzeugt und ein neuer Recovery-Code angelegt.
5. Der neue Klartextcode erscheint nur in der erfolgreichen HTTPS-Antwort und
   bleibt nur im React-Zustand der Ergebnisansicht. Ein Wiederholen der Antwort
   kann ihn nicht erneut liefern, weil Ceremony und alter Code bereits konsumiert
   sind.

## Abbruch und Ablauf

Ein Browser-Abbruch verbraucht die Ceremony nicht sofort. Solange die Seite offen
und die Ceremony gültig ist, kann die Person dieselbe Registration erneut
starten. Die UI warnt **vor** dem Claim und behält weder den eingegebenen Code
noch den neuen Code in Browser-Speichern.

Eine abgelaufene oder durch Fehlversuche ausgeschöpfte Ceremony konsumiert den
geclaimten Code endgültig; er wird niemals wieder `active`. Request-time-Cleanup
ruft `consumeUnusableRecoveryClaims` auf. Dieselbe Funktion ist ausdrücklich als
Hook für einen späteren periodischen Cleanup vorgesehen. Diese Fail-closed-
Semantik verhindert die Wiederverwendung eines bereits offengelegten Codes und
entspricht ADR 0001. Ohne verbliebenen Passkey, E-Mail- oder Support-Recovery ist
anschließend bewusst keine Wiederherstellung mehr möglich.

## Rate Limits

Der aktuelle MVP besitzt einen begrenzten In-Process-Fixed-Window-Schutz für
Globallast, vertrauenswürdig normalisierte Proxy-IP und Selector. Er führt keinen
Account-Lookup durch und speichert weder Secret noch vollständigen Code. Bei
mehreren Instanzen muss die Hosting-/Edge-Schicht dieselben drei Dimensionen in
einem gemeinsamen Store erzwingen; die Route hält diesen Integrationspunkt
getrennt von Recovery- und WebAuthn-Logik.
