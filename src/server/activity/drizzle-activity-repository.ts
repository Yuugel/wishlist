import "server-only";

import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { activities } from "../db/schema";
import {
  ACTIVITY_LIST_LIMIT,
  type ActivityEventType,
  type ActivityRecord,
  type ActivityRepository,
  type WishChangedActivityInput,
} from "./activity-repository";
import type { WishField } from "../wishes/wish-repository";

const activityColumns = {
  id: activities.id,
  recipientId: activities.recipientId,
  eventType: activities.eventType,
  wishId: activities.wishId,
  wishTitle: activities.wishTitle,
  changedFields: activities.changedFields,
  addedGroupIds: activities.addedGroupIds,
  removedGroupIds: activities.removedGroupIds,
  createdAt: activities.createdAt,
};

type ActivityRow = {
  id: string;
  recipientId: string;
  eventType: ActivityEventType;
  wishId: string | null;
  wishTitle: string;
  changedFields: string[];
  addedGroupIds: string[];
  removedGroupIds: string[];
  createdAt: Date;
};

function activityFromRow(row: ActivityRow): ActivityRecord {
  return {
    ...row,
    changedFields: [...row.changedFields] as WishField[],
    addedGroupIds: [...row.addedGroupIds],
    removedGroupIds: [...row.removedGroupIds],
  };
}

/** The insert side is used by the wish repository while its transaction is open. */
type ActivityInsertExecutor = Pick<typeof db, "insert">;

export async function insertWishChangedActivity(
  tx: ActivityInsertExecutor,
  input: WishChangedActivityInput,
): Promise<void> {
  await tx.insert(activities).values({
    recipientId: input.recipientId,
    eventType: "wish_changed",
    wishId: input.wishId,
    wishTitle: input.wishTitle,
    changedFields: input.changedFields,
    addedGroupIds: input.addedGroupIds,
    removedGroupIds: input.removedGroupIds,
    createdAt: input.createdAt,
  });
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
