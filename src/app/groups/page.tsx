import { GroupsPanel } from "../components/groups-panel";

export default function GroupsPage() {
  return (
    <main className="shell">
      <section className="card wide-card">
        <p className="eyebrow">Wishlist</p>
        <h1>Meine Gruppen</h1>
        <p className="intro">
          Öffne eine Gruppe, um ihre Mitglieder und die dort sichtbaren
          Wünsche zu sehen.
        </p>
        <GroupsPanel />
      </section>
    </main>
  );
}
