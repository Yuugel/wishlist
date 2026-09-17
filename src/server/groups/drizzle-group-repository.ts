import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  groupInvites,
  groupMemberships,
  groups,
  users,
} from "../db/schema";
import type { GroupRepository } from "./group-repository";
import type {
  GroupDetails,
  GroupSummary,
  JoinGroupResult,
  LeaveGroupResult,
} from "./group-types";

function summaryFromRow(row: {
  id: string;
  name: string;
  createdAt: Date;
}): GroupSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
  };
}

export const drizzleGroupRepository: GroupRepository = {
  async createGroupWithMember(input) {
    return db.transaction(async (tx) => {
      const [group] = await tx
        .insert(groups)
        .values({
          name: input.groupName,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({
          id: groups.id,
          name: groups.name,
          createdAt: groups.createdAt,
        });

      if (!group) throw new Error("Group creation failed");

      const [membership] = await tx
        .insert(groupMemberships)
        .values({
          groupId: group.id,
          userId: input.userId,
          createdAt: input.now,
        })
        .returning({ groupId: groupMemberships.groupId });

      if (!membership) throw new Error("Group membership creation failed");
      return summaryFromRow(group);
    });
  },

  async listGroupsForMember(userId) {
    const rows = await db
      .select({
        id: groups.id,
        name: groups.name,
        createdAt: groups.createdAt,
      })
      .from(groupMemberships)
      .innerJoin(groups, eq(groups.id, groupMemberships.groupId))
      .where(eq(groupMemberships.userId, userId))
      .orderBy(asc(groups.createdAt), asc(groups.id));

    return rows.map(summaryFromRow);
  },

  async getGroupForMember(groupId, userId): Promise<GroupDetails | null> {
    const [group] = await db
      .select({
        id: groups.id,
        name: groups.name,
        createdAt: groups.createdAt,
      })
      .from(groups)
      .innerJoin(
        groupMemberships,
        eq(groupMemberships.groupId, groups.id),
      )
      .where(
        and(eq(groups.id, groupId), eq(groupMemberships.userId, userId)),
      )
      .limit(1);

    if (!group) return null;

    const members = await db
      .select({
        id: users.id,
        displayName: users.displayName,
      })
      .from(groupMemberships)
      .innerJoin(users, eq(users.id, groupMemberships.userId))
      .where(eq(groupMemberships.groupId, groupId))
      .orderBy(asc(groupMemberships.createdAt), asc(users.id));

    return { ...summaryFromRow(group), members };
  },

  async createInviteForMember(input) {
    return db.transaction(async (tx) => {
      // Serialize invite creation with leave/dissolution so an invite cannot
      // be created for a group while its last member is leaving.
      const [group] = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.id, input.groupId))
        .for("update")
        .limit(1);
      if (!group) return null;

      const [membership] = await tx
        .select({ groupId: groupMemberships.groupId })
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, input.groupId),
            eq(groupMemberships.userId, input.userId),
          ),
        )
        .limit(1);
      if (!membership) return null;

      const [created] = await tx
        .insert(groupInvites)
        .values({
          groupId: input.groupId,
          selector: input.selector,
          digest: Buffer.from(input.digest),
          expiresAt: input.expiresAt,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ expiresAt: groupInvites.expiresAt });

      return created ?? null;
    });
  },

  async joinWithInvite(input): Promise<JoinGroupResult> {
    return db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ id: groupInvites.id, groupId: groupInvites.groupId })
        .from(groupInvites)
        .where(eq(groupInvites.selector, input.selector))
        .limit(1);
      if (!candidate) return { kind: "invalid-invite" };

      // Join and leave use the same group-row lock. The membership decision
      // and insert therefore see one serialized group state.
      const [group] = await tx
        .select({
          id: groups.id,
          name: groups.name,
          createdAt: groups.createdAt,
        })
        .from(groups)
        .where(eq(groups.id, candidate.groupId))
        .for("update")
        .limit(1);
      if (!group) return { kind: "invalid-invite" };

      const [invite] = await tx
        .select({
          id: groupInvites.id,
          digest: groupInvites.digest,
          expiresAt: groupInvites.expiresAt,
        })
        .from(groupInvites)
        .where(
          and(
            eq(groupInvites.id, candidate.id),
            eq(groupInvites.digest, Buffer.from(input.inviteDigest)),
          ),
        )
        .for("update")
        .limit(1);

      if (!invite || invite.expiresAt.getTime() <= input.now.getTime()) {
        return { kind: "invalid-invite" };
      }

      const [inserted] = await tx
        .insert(groupMemberships)
        .values({
          groupId: group.id,
          userId: input.userId,
          createdAt: input.now,
        })
        .onConflictDoNothing({
          target: [groupMemberships.groupId, groupMemberships.userId],
        })
        .returning({ userId: groupMemberships.userId });

      return {
        kind: inserted ? "joined" : "already-member",
        group: summaryFromRow(group),
      };
    });
  },

  async leaveGroup(input): Promise<LeaveGroupResult> {
    return db.transaction(async (tx) => {
      const [group] = await tx
        .select({
          id: groups.id,
          name: groups.name,
          createdAt: groups.createdAt,
        })
        .from(groups)
        .where(eq(groups.id, input.groupId))
        .for("update")
        .limit(1);
      if (!group) return { kind: "not-member" };

      const [departed] = await tx
        .delete(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, input.groupId),
            eq(groupMemberships.userId, input.userId),
          ),
        )
        .returning({ userId: groupMemberships.userId });
      if (!departed) return { kind: "not-member" };

      const remaining = await tx
        .select({ userId: groupMemberships.userId })
        .from(groupMemberships)
        .where(eq(groupMemberships.groupId, input.groupId))
        .orderBy(asc(groupMemberships.createdAt), asc(groupMemberships.userId));

      if (remaining.length <= 1) {
        // Foreign keys cascade the remaining membership and all invites in
        // the same transaction as the final leave.
        await tx.delete(groups).where(eq(groups.id, input.groupId));
        return {
          kind: "dissolved",
          event: {
            groupId: input.groupId,
            departedUserId: input.userId,
            remainingMemberIds: remaining.map((member) => member.userId),
            dissolvedAt: input.now,
          },
        };
      }

      return { kind: "left", group: summaryFromRow(group) };
    });
  },
};
