import { WishlistPanel } from "../components/wishlist-panel";

type WishlistPageProps = {
  searchParams: Promise<{ groupId?: string | string[] }>;
};

export default async function WishlistPage({
  searchParams,
}: WishlistPageProps) {
  const params = await searchParams;
  const groupId = Array.isArray(params.groupId)
    ? params.groupId[0]
    : params.groupId;

  return (
    <main className="shell">
      <section className="card wide-card">
        <p className="eyebrow">Wishlist</p>
        <h1>Meine Wunschliste</h1>
        <p className="intro">
          Private und gruppenzugeordnete Wünsche an einem Ort.
        </p>
        <WishlistPanel initialGroupId={groupId} />
      </section>
    </main>
  );
}
