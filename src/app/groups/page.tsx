import { GroupsPanel } from "../components/groups-panel";
import { AppShell } from "../components/app-shell";

type GroupsPageProps = {
  searchParams: Promise<{ leave?: string }>;
};

export default async function GroupsPage({ searchParams }: GroupsPageProps) {
  const leave = (await searchParams).leave;
  const leaveResult = leave === "left" || leave === "dissolved" ? leave : undefined;

  return (
    <AppShell
      eyebrow="Zusammen schenken"
      title="Meine Gruppen"
      description="Eure gemeinsamen Räume für Wünsche, Vorfreude und gut gehütete Überraschungen."
    >
      <GroupsPanel leaveResult={leaveResult} />
    </AppShell>
  );
}
