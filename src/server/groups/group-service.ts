import "server-only";

import {
  digestGroupInviteToken,
  generateGroupInviteToken,
  parseGroupInviteToken,
} from "./invite-token";
import type { GroupRepository, GroupServiceOptions } from "./group-repository";
import type { GroupDetails, GroupSummary } from "./group-types";

export const GROUP_NAME_MAX_LENGTH = 200;
export const GROUP_INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export type GroupServiceErrorCode =
  | "invalid_group_name"
  | "group_access_denied"
  | "invalid_invite";

export class GroupServiceError extends Error {
  constructor(
    public readonly code: GroupServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GroupServiceError";
  }
}

function normalizeGroupName(name: string): string {
  const normalized = typeof name === "string" ? name.trim() : "";
  const length = Array.from(normalized).length;

  if (length < 1 || length > GROUP_NAME_MAX_LENGTH) {
    throw new GroupServiceError(
      "invalid_group_name",
      "A group name must contain between 1 and 200 characters.",
    );
  }

  return normalized;
}

function requireActor(userId: string): void {
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new GroupServiceError(
      "group_access_denied",
      "An authenticated user is required.",
    );
  }
}

function invalidInvite(): GroupServiceError {
  return new GroupServiceError(
    "invalid_invite",
    "The invite is invalid or has expired.",
  );
}

export function createGroupService(
  repository: GroupRepository,
  options: GroupServiceOptions = {},
) {
  return {
    async createGroup(input: {
      userId: string;
      name: string;
      now?: Date;
    }): Promise<GroupSummary> {
      requireActor(input.userId);
      return repository.createGroupWithMember({
        groupName: normalizeGroupName(input.name),
        userId: input.userId,
        now: input.now ?? new Date(),
      });
    },

    async listGroups(input: { userId: string }): Promise<GroupSummary[]> {
      requireActor(input.userId);
      return repository.listGroupsForMember(input.userId);
    },

    async getGroup(input: {
      groupId: string;
      userId: string;
    }): Promise<GroupDetails> {
      requireActor(input.userId);
      const group = await repository.getGroupForMember(
        input.groupId,
        input.userId,
      );
      if (!group) {
        throw new GroupServiceError(
          "group_access_denied",
          "The group does not exist or the user is not a member.",
        );
      }
      return group;
    },

    async createInvite(input: {
      groupId: string;
      userId: string;
      now?: Date;
    }): Promise<{ token: string; expiresAt: Date }> {
      requireActor(input.userId);
      const now = input.now ?? new Date();
      const generated = generateGroupInviteToken();
      const expiresAt = new Date(now.getTime() + GROUP_INVITE_LIFETIME_MS);
      const created = await repository.createInviteForMember({
        groupId: input.groupId,
        userId: input.userId,
        selector: generated.selector,
        digest: generated.digest,
        expiresAt,
        now,
      });

      if (!created) {
        throw new GroupServiceError(
          "group_access_denied",
          "Only a current group member may create an invite.",
        );
      }

      return { token: generated.token, expiresAt: created.expiresAt };
    },

    async joinGroup(input: {
      token: string;
      userId: string;
      now?: Date;
    }): Promise<{ group: GroupSummary; joined: boolean }> {
      requireActor(input.userId);
      const parsed = parseGroupInviteToken(input.token);
      const inviteDigest = digestGroupInviteToken(input.token);
      if (!parsed || !inviteDigest) throw invalidInvite();

      const result = await repository.joinWithInvite({
        selector: parsed.selector,
        inviteDigest,
        userId: input.userId,
        now: input.now ?? new Date(),
      });

      if (result.kind === "invalid-invite") throw invalidInvite();

      return {
        group: result.group,
        joined: result.kind === "joined",
      };
    },

    async leaveGroup(input: {
      groupId: string;
      userId: string;
      now?: Date;
    }): Promise<{ dissolved: boolean; group: GroupSummary | null }> {
      requireActor(input.userId);
      const result = await repository.leaveGroup({
        groupId: input.groupId,
        userId: input.userId,
        now: input.now ?? new Date(),
      });

      if (result.kind === "not-member") {
        throw new GroupServiceError(
          "group_access_denied",
          "Only a current group member may leave the group.",
        );
      }

      if (result.kind === "dissolved") {
        // The repository has committed before this hook runs. Future activity
        // recording can use this seam without coupling groups to notifications
        // or wishes.
        await options.onGroupDissolved?.(result.event);
        return { dissolved: true, group: null };
      }

      return { dissolved: false, group: result.group };
    },
  };
}
