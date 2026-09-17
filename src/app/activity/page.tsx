import { ActivityPanel } from "../components/activity-panel";
import { AppShell } from "../components/app-shell";

export default function ActivityPage() {
  return (
    <AppShell
      eyebrow="Nichts verpassen"
      title="Activity"
      description="Wichtige Änderungen rund um Wünsche, die du übernommen hast. Dauerhaft und diskret festgehalten."
    >
      <ActivityPanel />
    </AppShell>
  );
}
