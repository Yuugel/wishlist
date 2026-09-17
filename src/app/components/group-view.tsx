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

type ApiWishFields = {
  id: string;
  title: string;
  description: string | null;
  link: string | null;
  priceText: string | null;
  createdAt: string;
  updatedAt: string;
};

type ViewerTakeoverStatus =
  | "available"
  | "reserved_by_you"
  | "reserved"
  | "purchased_by_you"
  | "purchased";

type ApiWish =
  | (ApiWishFields & { view: "owner" })
  | (ApiWishFields & {
      view: "viewer";
      takeoverStatus: ViewerTakeoverStatus;
    });

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

function takeoverLabel(status: ViewerTakeoverStatus): string | null {
  switch (status) {
    case "available":
      return null;
    case "reserved_by_you":
      return "Von dir übernommen";
    case "reserved":
      return "Reserviert";
    case "purchased_by_you":
      return "Von dir gekauft";
    case "purchased":
      return "Gekauft";
  }
}

export function GroupView({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [group, setGroup] = useState<ApiGroup>();
  const [memberWishes, setMemberWishes] = useState<ApiMemberWishes[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();
  const [actionMessage, setActionMessage] = useState<string>();
  const [busyWishId, setBusyWishId] = useState<string>();
  const [leaving, setLeaving] = useState(false);
  const [leaveNeedsConfirmation, setLeaveNeedsConfirmation] = useState(false);

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

  async function mutateTakeover(
    wishId: string,
    method: "POST" | "PATCH" | "DELETE",
    status?: "reserved" | "purchased",
  ) {
    setBusyWishId(wishId);
    setActionMessage(undefined);
    try {
      const response = await fetch(
        `/api/wishes/${encodeURIComponent(wishId)}/takeover`,
        {
          method,
          credentials: "same-origin",
          ...(status
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status }),
              }
            : {}),
        },
      );
      const data = (await response.json().catch(() => ({}))) as ApiError & {
        takeoverStatus?: ViewerTakeoverStatus;
      };
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok || !data.takeoverStatus) {
        throw new Error(data.message ?? "Der Status konnte nicht geändert werden.");
      }

      setMemberWishes((members) =>
        members.map((entry) => ({
          ...entry,
          wishes: entry.wishes.map((wish) =>
            wish.id === wishId && wish.view === "viewer"
              ? { ...wish, takeoverStatus: data.takeoverStatus! }
              : wish,
          ),
        })),
      );
    } catch (error) {
      setActionMessage(
        error instanceof Error
          ? error.message
          : "Der Status konnte nicht geändert werden.",
      );
    } finally {
      setBusyWishId(undefined);
    }
  }

  async function leaveGroup(confirmed: boolean) {
    setLeaving(true);
    setActionMessage(undefined);
    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(groupId)}/leave`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as ApiError & {
        requiresConfirmation?: boolean;
        dissolved?: boolean;
      };
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 409 && data.requiresConfirmation) {
        setLeaveNeedsConfirmation(true);
        return;
      }
      if (!response.ok) {
        throw new Error(data.message ?? "Die Gruppe konnte nicht verlassen werden.");
      }
      router.push(`/groups?leave=${data.dissolved ? "dissolved" : "left"}`);
    } catch (error) {
      setActionMessage(
        error instanceof Error
          ? error.message
          : "Die Gruppe konnte nicht verlassen werden.",
      );
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="stack">
      <div className="actions">
        <Link className="button-link secondary" href="/groups">
          Alle Gruppen
        </Link>
        <Link className="button-link secondary" href="/wishlist">
          Meine Wunschliste
        </Link>
        <Link className="button-link secondary" href="/activity">
          Activity
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

          {actionMessage && (
            <p className="notice" role="alert">{actionMessage}</p>
          )}

          {leaveNeedsConfirmation ? (
            <section className="group-section" aria-labelledby="leave-warning-heading">
              <h3 id="leave-warning-heading">Austritt bestätigen</h3>
              <p className="notice" role="alert">
                Durch deinen Austritt verlieren aktive Übernahmen ihre letzte
                gemeinsame Sichtbarkeit und werden automatisch freigegeben.
                Prüfe das bitte, bevor du bewusst fortfährst.
              </p>
              <div className="actions compact-actions">
                <button
                  type="button"
                  disabled={leaving}
                  onClick={() => void leaveGroup(true)}
                >
                  Gruppe trotzdem verlassen
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={leaving}
                  onClick={() => setLeaveNeedsConfirmation(false)}
                >
                  Abbrechen
                </button>
              </div>
            </section>
          ) : (
            <div className="actions compact-actions">
              <button
                className="secondary"
                type="button"
                disabled={leaving}
                onClick={() => void leaveGroup(false)}
              >
                Gruppe verlassen
              </button>
            </div>
          )}

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
                      {wishes.map((wish) => {
                        const busy = busyWishId === wish.id;
                        const status = wish.view === "viewer"
                          ? wish.takeoverStatus
                          : undefined;
                        const label = status ? takeoverLabel(status) : null;

                        return (
                          <div className="wish-item" key={wish.id}>
                            <div className="wish-item-heading">
                              <h5>{wish.title}</h5>
                              {wish.view === "owner" ? (
                                <span className="wish-audience">Dein Wunsch</span>
                              ) : label ? (
                                <span className="wish-audience">{label}</span>
                              ) : null}
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

                            {status === "available" && (
                              <div className="actions compact-actions">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void mutateTakeover(wish.id, "POST")}
                                >
                                  Übernehmen
                                </button>
                              </div>
                            )}
                            {status === "reserved_by_you" && (
                              <div className="actions compact-actions">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void mutateTakeover(wish.id, "PATCH", "purchased")
                                  }
                                >
                                  Gekauft
                                </button>
                                <button
                                  className="secondary"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void mutateTakeover(wish.id, "DELETE")}
                                >
                                  Freigeben
                                </button>
                              </div>
                            )}
                            {status === "purchased_by_you" && (
                              <div className="actions compact-actions">
                                <button
                                  className="secondary"
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void mutateTakeover(wish.id, "PATCH", "reserved")
                                  }
                                >
                                  Zurück auf Reserviert
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
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
