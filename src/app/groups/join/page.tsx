import { AppShell } from "../../components/app-shell";
import { JoinGroupPanel } from "../../components/join-group-panel";

type JoinGroupPageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

export default async function JoinGroupPage({ searchParams }: JoinGroupPageProps) {
  const value = (await searchParams).token;
  const token = Array.isArray(value) ? value[0] : value;

  return (
    <AppShell
      eyebrow="Gemeinsam wünschen"
      title="Gruppeneinladung"
      description="Ein Klick bringt dich zu eurer gemeinsamen Wunschübersicht."
    >
      <JoinGroupPanel token={token} />
    </AppShell>
  );
}
