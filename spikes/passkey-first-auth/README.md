# Passkey-first auth spike

Isolated, non-production proof of concept for issue #4. It verifies two bounded
assumptions:

- SimpleWebAuthn can create discoverable-credential registration and
  username-less authentication options from an opaque account handle and a
  display name, with no email or password.
- A high-entropy recovery bearer code can be shown once while only a selector
  and HMAC digest are retained, and its state can reject a second use.

It does **not** expose HTTP endpoints, connect PostgreSQL, create a session, or
complete a browser/authenticator ceremony. The in-memory recovery store only
illustrates the state transition; production code needs the conditional SQL
operation described in the decision record.

## Run

Requires Node.js 20 or newer.

```sh
cd spikes/passkey-first-auth
npm ci
npm run check
npm test
```

Tests generate random values at runtime and do not print them. Do not add real
recovery codes, peppers, credentials, or session secrets to this directory.
