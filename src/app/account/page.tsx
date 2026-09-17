import { AccountPanel } from "../components/passkey-flows";
import { AppShell } from "../components/app-shell";

export default function AccountPage() {
  return (
    <AppShell
      eyebrow="Sicher bei dir"
      title="Dein Konto"
      description="Verwalte deine Passkeys und deine aktuelle Anmeldung."
    >
      <AccountPanel />
    </AppShell>
  );
}
