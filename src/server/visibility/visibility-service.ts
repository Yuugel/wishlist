import "server-only";

import { GroupServiceError } from "../groups/group-service";
import { toViewerTakeoverStatus } from "../takeovers/takeover-service";
import {
  toGroupOwnerWishView,
  toGroupViewerWishView,
} from "../wishes/wish-view";
import type { VisibilityRepository } from "./visibility-repository";
import type { GroupWishVisibility } from "./visibility-types";

function requireActor(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GroupServiceError(
      "group_access_denied",
      "An authenticated user is required.",
    );
  }
  return value.trim();
}

function requireGroupId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GroupServiceError(
      "group_access_denied",
      "The group does not exist or the user is not a member.",
    );
  }
  return value.trim();
}

function accessDenied(): GroupServiceError {
  return new GroupServiceError(
    "group_access_denied",
    "The group does not exist or the user is not a member.",
  );
}

export function createVisibilityService(repository: VisibilityRepository) {
  async function authorizeGroup(groupId: string, userId: string) {
    const normalizedGroupId = requireGroupId(groupId);
    const normalizedUserId = requireActor(userId);
    const group = await repository.getGroupForMember(
      normalizedGroupId,
      normalizedUserId,
    );
    if (!group) throw accessDenied();
    return { group, groupId: normalizedGroupId, userId: normalizedUserId };
  }

  return {
    async getGroup(input: {
      groupId: string;
      userId: string;
    }) {
      const authorized = await authorizeGroup(input.groupId, input.userId);
      return authorized.group;
    },

    async listGroupWishes(input: {
      groupId: string;
      userId: string;
    }): Promise<GroupWishVisibility> {
      const authorized = await authorizeGroup(input.groupId, input.userId);
      const records = await repository.listWishesForMemberInGroup(
        authorized.groupId,
        authorized.userId,
      );
      if (!records) throw accessDenied();

      const wishesByMember = new Map(
        authorized.group.members.map((member) => [
          member.id,
          [] as GroupWishVisibility["members"][number]["wishes"],
        ]),
      );

      for (const record of records) {
        // Defense in depth: the repository query is group-scoped as well.
        if (record.groupId !== authorized.groupId) continue;

        const memberWishes = wishesByMember.get(record.ownerId);
        // A wish assigned by a former/non-member is not attributed to a
        // current member and therefore is not part of this member view.
        if (!memberWishes) continue;

        memberWishes.push(
          record.ownerId === authorized.userId
            ? toGroupOwnerWishView(record)
            : toGroupViewerWishView(
                record,
                toViewerTakeoverStatus(
                  record.takeoverStatus,
                  record.takeoverTakerId === authorized.userId,
                ),
              ),
        );
      }

      return {
        groupId: authorized.group.id,
        members: authorized.group.members.map((member) => ({
          member: { ...member },
          wishes: wishesByMember.get(member.id) ?? [],
        })),
      };
    },
  };
}

export type VisibilityService = ReturnType<typeof createVisibilityService>;
