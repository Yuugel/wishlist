import { GroupView } from "../../components/group-view";
import { AppShell } from "../../components/app-shell";

type GroupPageProps = {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ joined?: string }>;
};

export default async function GroupPage({ params, searchParams }: GroupPageProps) {
  const { groupId } = await params;
  const joined = (await searchParams).joined;
  return (
    <AppShell
      eyebrow="Gemeinsam wünschen"
      title="Gruppenraum"
      description="Alle Menschen und geteilten Wünsche dieser Gruppe an einem Ort."
    >
      <GroupView
        groupId={groupId}
        joinResult={joined === "yes" || joined === "already" ? joined : undefined}
      />
    </AppShell>
  );
}
