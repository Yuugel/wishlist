import "server-only";

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { createWishChangedActivity } from "../activity/activity-service";
import { insertWishChangedActivity } from "../activity/drizzle-activity-repository";
import { db } from "../db/client";
import {
  groupMemberships,
  groups,
  wishGroups,
  wishes,
  wishTakeovers,
} from "../db/schema";
import type {
  CreateWishResult,
  UpdateWishResult,
  WishChangeSet,
  WishField,
  WishRecord,
  WishRepository,
} from "./wish-repository";

export const wishColumns = {
  id: wishes.id,
  ownerId: wishes.ownerId,
  title: wishes.title,
  description: wishes.description,
  link: wishes.link,
  priceText: wishes.priceText,
  createdAt: wishes.createdAt,
  updatedAt: wishes.updatedAt,
};

function asWish(
  row: {
    id: string;
    ownerId: string;
    title: string;
    description: string | null;
    link: string | null;
    priceText: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  assignedGroups: WishRecord["groups"],
): WishRecord {
  return { ...row, groups: assignedGroups };
}

function invalidGroupIds(
  requestedGroupIds: string[],
  memberGroupIds: Iterable<string>,
): string[] {
  const members = new Set(memberGroupIds);
  return requestedGroupIds.filter((groupId) => !members.has(groupId));
}

async function groupsForWishes(
  wishIds: string[],
): Promise<Map<string, WishRecord["groups"]>> {
  const result = new Map<string, WishRecord["groups"]>();
  for (const wishId of wishIds) result.set(wishId, []);
  if (wishIds.length === 0) return result;

  const rows = await db
    .select({
      wishId: wishGroups.wishId,
      id: groups.id,
      name: groups.name,
      createdAt: groups.createdAt,
    })
    .from(wishGroups)
    .innerJoin(groups, eq(groups.id, wishGroups.groupId))
    .where(inArray(wishGroups.wishId, wishIds))
    .orderBy(
      asc(wishGroups.wishId),
      asc(groups.createdAt),
      asc(groups.id),
    );

  for (const row of rows) {
    result.get(row.wishId)?.push({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
    });
  }
  return result;
}

export const drizzleWishRepository: WishRepository = {
  async createWish(input): Promise<CreateWishResult> {
    return db.transaction(async (tx) => {
      const memberGroups =
        input.groupIds.length === 0
          ? []
          : await tx
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
                and(
                  eq(groupMemberships.userId, input.ownerId),
                  inArray(groups.id, input.groupIds),
                ),
              )
              .for("update");
      const invalidIds = invalidGroupIds(
        input.groupIds,
        memberGroups.map((group) => group.id),
      );
      if (invalidIds.length > 0) {
        return { kind: "invalid-groups", invalidGroupIds: invalidIds };
      }

      const [created] = await tx
        .insert(wishes)
        .values({
          ownerId: input.ownerId,
          title: input.values.title,
          description: input.values.description,
          link: input.values.link,
          priceText: input.values.priceText,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning(wishColumns);
      if (!created) throw new Error("Wish creation failed");

      if (input.groupIds.length > 0) {
        await tx.insert(wishGroups).values(
          input.groupIds.map((groupId) => ({
            wishId: created.id,
            groupId,
            createdAt: input.now,
          })),
        );
      }

      const groupsById = new Map(
        memberGroups.map((group) => [group.id, group]),
      );
      return {
        kind: "created",
        wish: asWish(
          created,
          input.groupIds.map((groupId) => groupsById.get(groupId)!),
        ),
      };
    });
  },

  async listWishesForOwner(ownerId): Promise<WishRecord[]> {
    const rows = await db
      .select(wishColumns)
      .from(wishes)
      .where(eq(wishes.ownerId, ownerId))
      .orderBy(desc(wishes.createdAt), asc(wishes.id));
    const assignedGroups = await groupsForWishes(rows.map((row) => row.id));
    return rows.map((row) => asWish(row, assignedGroups.get(row.id) ?? []));
  },

  async updateWish(input): Promise<UpdateWishResult> {
    return db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ id: wishes.id })
        .from(wishes)
        .where(
          and(eq(wishes.id, input.wishId), eq(wishes.ownerId, input.ownerId)),
        )
        .limit(1);
      if (!candidate) return { kind: "not-found" };

      let requestedGroups:
        | Array<{ id: string; name: string; createdAt: Date }>
        | undefined;
      if (input.groupIds !== undefined && input.groupIds.length > 0) {
        requestedGroups = await tx
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
            and(
              eq(groupMemberships.userId, input.ownerId),
              inArray(groups.id, input.groupIds),
            ),
          )
          .for("update");
        const invalidIds = invalidGroupIds(
          input.groupIds,
          requestedGroups.map((group) => group.id),
        );
        if (invalidIds.length > 0) {
          return { kind: "invalid-groups", invalidGroupIds: invalidIds };
        }
      } else if (input.groupIds !== undefined) {
        requestedGroups = [];
      }

      const [existing] = await tx
        .select(wishColumns)
        .from(wishes)
        .where(
          and(eq(wishes.id, input.wishId), eq(wishes.ownerId, input.ownerId)),
        )
        .for("update")
        .limit(1);
      if (!existing) return { kind: "not-found" };

      const currentGroupRows = await tx
        .select({ groupId: wishGroups.groupId })
        .from(wishGroups)
        .where(eq(wishGroups.wishId, input.wishId))
        .orderBy(asc(wishGroups.groupId));
      const currentGroupIds = currentGroupRows.map((row) => row.groupId);
      const targetGroupIds = input.groupIds ?? currentGroupIds;
      const currentGroupSet = new Set(currentGroupIds);
      const targetGroupSet = new Set(targetGroupIds);
      const addedGroupIds = targetGroupIds.filter(
        (groupId) => !currentGroupSet.has(groupId),
      );
      const removedGroupIds = currentGroupIds.filter(
        (groupId) => !targetGroupSet.has(groupId),
      );

      const changedFields: WishField[] = [];
      if (
        Object.prototype.hasOwnProperty.call(input.values, "title") &&
        input.values.title !== existing.title
      ) {
        changedFields.push("title");
      }
      if (
        Object.prototype.hasOwnProperty.call(input.values, "description") &&
        input.values.description !== existing.description
      ) {
        changedFields.push("description");
      }
      if (
        Object.prototype.hasOwnProperty.call(input.values, "link") &&
        input.values.link !== existing.link
      ) {
        changedFields.push("link");
      }
      if (
        Object.prototype.hasOwnProperty.call(input.values, "priceText") &&
        input.values.priceText !== existing.priceText
      ) {
        changedFields.push("priceText");
      }

      const changes: WishChangeSet = {
        changedFields,
        addedGroupIds,
        removedGroupIds,
        isNoop: changedFields.length === 0 &&
          addedGroupIds.length === 0 &&
          removedGroupIds.length === 0,
      };
      if (changes.isNoop) {
        const currentGroups = await tx
          .select({
            id: groups.id,
            name: groups.name,
            createdAt: groups.createdAt,
          })
          .from(wishGroups)
          .innerJoin(groups, eq(groups.id, wishGroups.groupId))
          .where(eq(wishGroups.wishId, input.wishId))
          .orderBy(asc(groups.createdAt), asc(groups.id));
        return {
          kind: "updated",
          wish: asWish(existing, currentGroups),
          changes,
        };
      }

      const updateValues: {
        title?: string;
        description?: string | null;
        link?: string | null;
        priceText?: string | null;
        updatedAt: Date;
      } = { updatedAt: input.now };
      if (changedFields.includes("title")) updateValues.title = input.values.title;
      if (changedFields.includes("description")) {
        updateValues.description = input.values.description;
      }
      if (changedFields.includes("link")) updateValues.link = input.values.link;
      if (changedFields.includes("priceText")) {
        updateValues.priceText = input.values.priceText;
      }

      const [updated] = await tx
        .update(wishes)
        .set(updateValues)
        .where(eq(wishes.id, input.wishId))
        .returning(wishColumns);
      if (!updated) return { kind: "not-found" };

      if (removedGroupIds.length > 0) {
        await tx
          .delete(wishGroups)
          .where(
            and(
              eq(wishGroups.wishId, input.wishId),
              inArray(wishGroups.groupId, removedGroupIds),
            ),
          );
      }
      if (addedGroupIds.length > 0) {
        await tx
          .insert(wishGroups)
          .values(
            addedGroupIds.map((groupId) => ({
              wishId: input.wishId,
              groupId,
              createdAt: input.now,
            })),
          )
          .onConflictDoNothing({
            target: [wishGroups.wishId, wishGroups.groupId],
          });
      }

      // The wish row is locked above and takeover mutations use the same row
      // lock. The snapshot therefore identifies the one current taker for
      // this committed wish change without exposing takeover data to the
      // owner-facing result.
      const [activeTakeover] = await tx
        .select({
          takerId: wishTakeovers.takerId,
          status: wishTakeovers.status,
        })
        .from(wishTakeovers)
        .where(
          and(
            eq(wishTakeovers.wishId, input.wishId),
            ne(wishTakeovers.takerId, input.ownerId),
          ),
        )
        .for("update")
        .limit(1);
      if (activeTakeover) {
        const activity = createWishChangedActivity({
          activeTakeover,
          wishId: input.wishId,
          wishTitle: updated.title,
          changes,
          createdAt: input.now,
        });
        if (activity) await insertWishChangedActivity(tx, activity);
      }

      const finalGroups = await tx
        .select({
          id: groups.id,
          name: groups.name,
          createdAt: groups.createdAt,
        })
        .from(wishGroups)
        .innerJoin(groups, eq(groups.id, wishGroups.groupId))
        .where(eq(wishGroups.wishId, input.wishId))
        .orderBy(asc(groups.createdAt), asc(groups.id));
      return { kind: "updated", wish: asWish(updated, finalGroups), changes };
    });
  },

  async deleteWish(input): Promise<boolean> {
    const [deleted] = await db
      .delete(wishes)
      .where(and(eq(wishes.id, input.wishId), eq(wishes.ownerId, input.ownerId)))
      .returning({ id: wishes.id });
    return deleted !== undefined;
  },
};
