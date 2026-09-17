import { ActivityPanel } from "../components/activity-panel";

export default function ActivityPage() {
  return (
    <main className="shell">
      <section className="card wide-card">
        <p className="eyebrow">Wishlist</p>
        <h1>Activity</h1>
        <p className="intro">
          Hier findest du die dauerhaften Hinweise zu deinen übernommenen
          Wünschen.
        </p>
        <ActivityPanel />
      </section>
    </main>
  );
}
