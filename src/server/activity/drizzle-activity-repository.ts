import "server-only";

import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { activities } from "../db/schema";
import {
  ACTIVITY_LIST_LIMIT,
  type ActivityInput,
  type ActivityRecord,
  type ActivityRepository,
  type WishChangedActivityInput,
} from "./activity-repository";
import type { TakeoverStatus } from "../takeovers/takeover-repository";
import type { WishField } from "../wishes/wish-repository";

const activityColumns = {
  id: activities.id,
  recipientId: activities.recipientId,
  eventType: activities.eventType,
  wishId: activities.wishId,
  wishTitle: activities.wishTitle,
  takeoverStatus: activities.takeoverStatus,
  groupName: activities.groupName,
  changedFields: activities.changedFields,
  addedGroupIds: activities.addedGroupIds,
  removedGroupIds: activities.removedGroupIds,
  createdAt: activities.createdAt,
};

type ActivityRow = {
  id: string;
  recipientId: string;
  eventType: ActivityRecord["eventType"];
  wishId: string | null;
  wishTitle: string | null;
  takeoverStatus: TakeoverStatus | null;
  groupName: string | null;
  changedFields: string[];
  addedGroupIds: string[];
  removedGroupIds: string[];
  createdAt: Date;
};

function activityFromRow(row: ActivityRow): ActivityRecord {
  const common = {
    id: row.id,
    recipientId: row.recipientId,
    createdAt: row.createdAt,
  };
  if (row.eventType === "group_dissolved") {
    if (!row.groupName) throw new Error("Group activity is missing its snapshot");
    return {
      ...common,
      eventType: row.eventType,
      wishId: null,
      wishTitle: null,
      takeoverStatus: null,
      groupName: row.groupName,
      changedFields: [],
      addedGroupIds: [],
      removedGroupIds: [],
    };
  }
  if (row.eventType === "wish_changed") {
    if (!row.wishTitle) {
      throw new Error("Wish change activity is missing its title snapshot");
    }
    return {
      ...common,
      eventType: row.eventType,
      wishId: row.wishId,
      wishTitle: row.wishTitle,
      takeoverStatus: null,
      groupName: null,
      changedFields: [...row.changedFields] as WishField[],
      addedGroupIds: [...row.addedGroupIds],
      removedGroupIds: [...row.removedGroupIds],
    };
  }
  if (!row.wishTitle || !row.takeoverStatus) {
    throw new Error("Takeover lifecycle activity is missing its snapshot");
  }
  return {
    ...common,
    eventType: row.eventType,
    wishId: row.wishId,
    wishTitle: row.wishTitle,
    takeoverStatus: row.takeoverStatus,
    groupName: null,
    changedFields: [],
    addedGroupIds: [],
    removedGroupIds: [],
  };
}

type ActivityInsertExecutor = Pick<typeof db, "insert">;

export async function insertActivity(
  tx: ActivityInsertExecutor,
  input: ActivityInput,
): Promise<void> {
  await tx.insert(activities).values({
    recipientId: input.recipientId,
    eventType: input.eventType,
    wishId: input.wishId,
    wishTitle: input.wishTitle,
    takeoverStatus: input.takeoverStatus,
    groupName: input.groupName,
    changedFields: input.changedFields,
    addedGroupIds: input.addedGroupIds,
    removedGroupIds: input.removedGroupIds,
    createdAt: input.createdAt,
  });
}

export async function insertWishChangedActivity(
  tx: ActivityInsertExecutor,
  input: WishChangedActivityInput,
): Promise<void> {
  await insertActivity(tx, input);
}

export const drizzleActivityRepository: ActivityRepository = {
  async listForRecipient(recipientId): Promise<ActivityRecord[]> {
    const rows = await db
      .select(activityColumns)
      .from(activities)
      .where(eq(activities.recipientId, recipientId))
      .orderBy(desc(activities.createdAt), asc(activities.id))
      .limit(ACTIVITY_LIST_LIMIT);
    return rows.map((row) => activityFromRow(row as ActivityRow));
  },
};
