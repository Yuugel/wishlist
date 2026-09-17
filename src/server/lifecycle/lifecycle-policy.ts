import type { TakeoverStatus } from "../takeovers/takeover-repository";

export type MembershipState = ReadonlyMap<string, ReadonlySet<string>>;

export type ActiveTakeoverVisibility = {
  wishId: string;
  ownerId: string;
  takerId: string;
  status: TakeoverStatus;
  wishGroupIds: readonly string[];
};

export function hasCommonWishVisibility(
  takeover: ActiveTakeoverVisibility,
  memberships: MembershipState,
  options: {
    excludedGroupIds?: ReadonlySet<string>;
    excludedMembership?: { groupId: string; userId: string };
  } = {},
): boolean {
  return takeover.wishGroupIds.some((groupId) => {
    if (options.excludedGroupIds?.has(groupId)) return false;
    const members = memberships.get(groupId);
    if (!members) return false;
    const isMember = (userId: string) =>
      !(
        options.excludedMembership?.groupId === groupId &&
        options.excludedMembership.userId === userId
      ) && members.has(userId);
    return isMember(takeover.ownerId) && isMember(takeover.takerId);
  });
}

/**
 * Preview exactly the active takeovers a leave would invalidate. The caller
 * supplies current server state; no client-provided takeover list participates.
 */
export function takeoversAffectedByGroupExit(
  takeovers: readonly ActiveTakeoverVisibility[],
  memberships: MembershipState,
  input: { groupId: string; userId: string; dissolves: boolean },
): ActiveTakeoverVisibility[] {
  const removedGroups = input.dissolves
    ? new Set([input.groupId])
    : undefined;

  return takeovers.filter((takeover) => {
    if (!takeover.wishGroupIds.includes(input.groupId)) return false;
    if (
      !input.dissolves &&
      takeover.ownerId !== input.userId &&
      takeover.takerId !== input.userId
    ) {
      return false;
    }
    return !hasCommonWishVisibility(takeover, memberships, {
      excludedGroupIds: removedGroups,
      excludedMembership: input.dissolves
        ? undefined
        : { groupId: input.groupId, userId: input.userId },
    });
  });
}
