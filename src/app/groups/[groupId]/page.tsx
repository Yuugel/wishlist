import { GroupView } from "../../components/group-view";

type GroupPageProps = {
  params: Promise<{ groupId: string }>;
};

export default async function GroupPage({ params }: GroupPageProps) {
  const { groupId } = await params;
  return (
    <main className="shell">
      <section className="card wide-card">
        <GroupView groupId={groupId} />
      </section>
    </main>
  );
}
