import { WishlistPanel } from "../components/wishlist-panel";
import { AppShell } from "../components/app-shell";

type WishlistPageProps = {
  searchParams: Promise<{
    groupId?: string | string[];
    new?: string | string[];
  }>;
};

export default async function WishlistPage({
  searchParams,
}: WishlistPageProps) {
  const params = await searchParams;
  const groupId = Array.isArray(params.groupId)
    ? params.groupId[0]
    : params.groupId;
  const openCreate = (Array.isArray(params.new) ? params.new[0] : params.new) === "1";

  return (
    <AppShell
      eyebrow="Dein Wunschraum"
      title="Meine Wunschliste"
      description="Sammle, was dir Freude macht – privat für dich oder geteilt mit deinen Gruppen."
    >
      <WishlistPanel initialGroupId={groupId} initiallyOpen={openCreate} />
    </AppShell>
  );
}
