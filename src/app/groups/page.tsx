import { GroupsPanel } from "../components/groups-panel";

type GroupsPageProps = {
  searchParams: Promise<{ leave?: string }>;
};

export default async function GroupsPage({ searchParams }: GroupsPageProps) {
  const leave = (await searchParams).leave;
  const leaveResult = leave === "left" || leave === "dissolved" ? leave : undefined;

  return (
    <main className="shell">
      <section className="card wide-card">
        <p className="eyebrow">Wishlist</p>
        <h1>Meine Gruppen</h1>
        <p className="intro">
          Öffne eine Gruppe, um ihre Mitglieder und die dort sichtbaren
          Wünsche zu sehen.
        </p>
        <GroupsPanel leaveResult={leaveResult} />
      </section>
    </main>
  );
}
