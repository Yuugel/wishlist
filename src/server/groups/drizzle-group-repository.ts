import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  createGroupDissolvedActivity,
  createTakeoverReleasedActivity,
} from "../activity/activity-service";
import { insertActivity } from "../activity/drizzle-activity-repository";
import { db } from "../db/client";
import {
  groupInvites,
  groupMemberships,
  groups,
  users,
  wishes,
  wishTakeovers,
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
      // Joins, wish assignment changes, and leaves serialize on the group row.
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

      const members = await tx
        .select({ userId: groupMemberships.userId })
        .from(groupMemberships)
        .where(eq(groupMemberships.groupId, input.groupId))
        .orderBy(asc(groupMemberships.createdAt), asc(groupMemberships.userId));
      if (!members.some((member) => member.userId === input.userId)) {
        return { kind: "not-member" };
      }

      const dissolves = members.length <= 2;
      const candidateResult = await tx.execute<{ wish_id: string }>(sql`
        select distinct wish.id as wish_id
        from wish_groups assignment
        inner join wishes wish on wish.id = assignment.wish_id
        inner join wish_takeovers takeover on takeover.wish_id = wish.id
        where assignment.group_id = ${input.groupId}
          and (
            ${dissolves}
            or wish.owner_id = ${input.userId}
            or takeover.taker_id = ${input.userId}
          )
        order by wish.id
      `);
      const candidateWishIds = candidateResult.rows.map((row) => row.wish_id);

      // Every takeover mutation follows the same wish-row lock. Lock all
      // candidates before previewing or mutating membership state.
      if (candidateWishIds.length > 0) {
        await tx
          .select({ id: wishes.id })
          .from(wishes)
          .where(inArray(wishes.id, candidateWishIds))
          .orderBy(asc(wishes.id))
          .for("update");
      }

      const affected = candidateWishIds.length === 0
        ? []
        : (await tx.execute<{ wish_id: string }>(sql`
            select takeover.wish_id
            from wish_takeovers takeover
            inner join wishes wish on wish.id = takeover.wish_id
            where takeover.wish_id = any(${candidateWishIds}::uuid[])
              and not exists (
                select 1
                from wish_groups assignment
                inner join group_memberships owner_membership
                  on owner_membership.group_id = assignment.group_id
                 and owner_membership.user_id = wish.owner_id
                inner join group_memberships taker_membership
                  on taker_membership.group_id = assignment.group_id
                 and taker_membership.user_id = takeover.taker_id
                where assignment.wish_id = wish.id
                  and assignment.group_id <> ${input.groupId}
              )
          `)).rows;

      if (affected.length > 0 && !input.confirmed) {
        // Deliberately return no count, identity, wish, status, or recipient.
        return { kind: "confirmation-required" };
      }

      await tx
        .delete(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, input.groupId),
            eq(groupMemberships.userId, input.userId),
          ),
        );

      const remainingMemberIds = members
        .map((member) => member.userId)
        .filter((userId) => userId !== input.userId);
      if (dissolves) {
        // Cascades remove the remaining membership, invites, and wish-group
        // assignments, but never the wishes themselves.
        await tx.delete(groups).where(eq(groups.id, input.groupId));
      }

      // Re-evaluate after the membership/group mutation. Preview data is never
      // trusted by the confirmed request.
      const invalidTakeovers = candidateWishIds.length === 0
        ? []
        : (await tx.execute<{
            wish_id: string;
            taker_id: string;
            status: "reserved" | "purchased";
            title: string;
          }>(sql`
            select takeover.wish_id, takeover.taker_id, takeover.status, wish.title
            from wish_takeovers takeover
            inner join wishes wish on wish.id = takeover.wish_id
            where takeover.wish_id = any(${candidateWishIds}::uuid[])
              and not exists (
                select 1
                from wish_groups assignment
                inner join group_memberships owner_membership
                  on owner_membership.group_id = assignment.group_id
                 and owner_membership.user_id = wish.owner_id
                inner join group_memberships taker_membership
                  on taker_membership.group_id = assignment.group_id
                 and taker_membership.user_id = takeover.taker_id
                where assignment.wish_id = wish.id
              )
            order by takeover.wish_id
          `)).rows;

      if (invalidTakeovers.length > 0) {
        await tx
          .delete(wishTakeovers)
          .where(
            inArray(
              wishTakeovers.wishId,
              invalidTakeovers.map((takeover) => takeover.wish_id),
            ),
          );
        for (const takeover of invalidTakeovers) {
          await insertActivity(
            tx,
            createTakeoverReleasedActivity({
              recipientId: takeover.taker_id,
              wishId: takeover.wish_id,
              wishTitle: takeover.title,
              takeoverStatus: takeover.status,
              createdAt: input.now,
            }),
          );
        }
      }

      if (dissolves) {
        for (const recipientId of remainingMemberIds) {
          await insertActivity(
            tx,
            createGroupDissolvedActivity({
              recipientId,
              groupName: group.name,
              createdAt: input.now,
            }),
          );
        }
        return {
          kind: "dissolved",
          event: {
            groupId: input.groupId,
            groupName: group.name,
            departedUserId: input.userId,
            remainingMemberIds,
            dissolvedAt: input.now,
          },
        };
      }

      return { kind: "left", group: summaryFromRow(group) };
    });
  },
};
