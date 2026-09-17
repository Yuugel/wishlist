"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ApiMember = {
  id: string;
  displayName: string;
};

type ApiGroup = {
  id: string;
  name: string;
  createdAt: string;
  members: ApiMember[];
};

type ApiWish = {
  view: "owner" | "viewer";
  id: string;
  title: string;
  description: string | null;
  link: string | null;
  priceText: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApiMemberWishes = {
  member: ApiMember;
  wishes: ApiWish[];
};

type ApiError = {
  message?: string;
};

type ApiGroupResponse = ApiError & {
  group?: ApiGroup;
};

export function GroupView({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [group, setGroup] = useState<ApiGroup>();
  const [memberWishes, setMemberWishes] = useState<ApiMemberWishes[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const encodedId = encodeURIComponent(groupId);
        const [groupResponse, wishesResponse] = await Promise.all([
          fetch(`/api/groups/${encodedId}`, {
            credentials: "same-origin",
            cache: "no-store",
          }),
          fetch(`/api/groups/${encodedId}/wishes`, {
            credentials: "same-origin",
            cache: "no-store",
          }),
        ]);
        const groupData = (await groupResponse.json().catch(() => ({}))) as
          ApiGroupResponse;
        const wishesData = (await wishesResponse.json().catch(() => ({}))) as {
          members?: ApiMemberWishes[];
          message?: string;
        } & ApiError;

        if (!groupResponse.ok || !wishesResponse.ok) {
          const response = !groupResponse.ok ? groupResponse : wishesResponse;
          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          throw new Error(
            ("message" in groupData && groupData.message) ||
              wishesData.message ||
              "Die Gruppe konnte nicht geladen werden.",
          );
        }

        if (cancelled) return;
        if (!groupData.group) {
          throw new Error("Die Gruppendaten sind unvollständig.");
        }
        setGroup(groupData.group);
        setMemberWishes(wishesData.members ?? []);
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Die Gruppe konnte nicht geladen werden.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [groupId, router]);

  return (
    <div className="stack">
      <div className="actions">
        <Link className="button-link secondary" href="/groups">
          Alle Gruppen
        </Link>
        <Link className="button-link secondary" href="/wishlist">
          Meine Wunschliste
        </Link>
      </div>

      {loading ? (
        <p className="intro">Gruppe wird geladen …</p>
      ) : message ? (
        <p className="notice" role="alert">{message}</p>
      ) : group ? (
        <>
          <div>
            <p className="eyebrow">Gruppe</p>
            <h2>{group.name}</h2>
            <p className="intro">
              Nur dieser Gruppe zugeordnete Wünsche werden angezeigt.
            </p>
          </div>

          <section className="group-section" aria-labelledby="members-heading">
            <h3 id="members-heading">Mitglieder</h3>
            <ul className="member-list compact-member-list">
              {group.members.map((member) => (
                <li key={member.id}>{member.displayName}</li>
              ))}
            </ul>
          </section>

          <section className="group-section" aria-labelledby="wishes-heading">
            <h3 id="wishes-heading">Wünsche in dieser Gruppe</h3>
            <div className="member-wish-list">
              {memberWishes.map(({ member, wishes }) => (
                <article className="member-card" key={member.id}>
                  <h4>{member.displayName}</h4>
                  {wishes.length === 0 ? (
                    <p className="hint">Keine sichtbaren Wünsche.</p>
                  ) : (
                    <div className="wish-list nested-wish-list">
                      {wishes.map((wish) => (
                        <div className="wish-item" key={wish.id}>
                          <div className="wish-item-heading">
                            <h5>{wish.title}</h5>
                            {wish.view === "owner" && (
                              <span className="wish-audience">Dein Wunsch</span>
                            )}
                          </div>
                          {wish.description && <p>{wish.description}</p>}
                          {wish.link && (
                            <p>
                              <a href={wish.link} target="_blank" rel="noreferrer">
                                Link öffnen
                              </a>
                            </p>
                          )}
                          {wish.priceText && (
                            <p className="wish-price">{wish.priceText}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
