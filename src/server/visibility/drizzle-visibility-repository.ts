import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { groupMemberships, wishGroups, wishes } from "../db/schema";
import { wishColumns } from "../wishes/drizzle-wish-repository";
import type { VisibilityRepository } from "./visibility-repository";

export const drizzleVisibilityRepository: VisibilityRepository = {
  async getGroupForMember(groupId, userId) {
    const { drizzleGroupRepository } = await import(
      "../groups/drizzle-group-repository"
    );
    return drizzleGroupRepository.getGroupForMember(groupId, userId);
  },

  async listWishesForMemberInGroup(groupId, userId) {
    const [membership] = await db
      .select({ groupId: groupMemberships.groupId })
      .from(groupMemberships)
      .where(
        and(
          eq(groupMemberships.groupId, groupId),
          eq(groupMemberships.userId, userId),
        ),
      )
      .limit(1);
    if (!membership) return null;

    return db
      .select({
        ...wishColumns,
        groupId: wishGroups.groupId,
      })
      .from(wishes)
      .innerJoin(wishGroups, eq(wishGroups.wishId, wishes.id))
      .where(eq(wishGroups.groupId, groupId))
      .orderBy(desc(wishes.createdAt), asc(wishes.id));
  },
};
