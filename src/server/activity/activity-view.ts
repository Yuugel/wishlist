import type { ActivityRecord } from "./activity-repository";

export function serializeActivity(activity: ActivityRecord) {
  return {
    id: activity.id,
    eventType: activity.eventType,
    wishId: activity.wishId,
    wishTitle: activity.wishTitle,
    changedFields: activity.changedFields,
    addedGroupIds: activity.addedGroupIds,
    removedGroupIds: activity.removedGroupIds,
    createdAt: activity.createdAt.toISOString(),
  };
}
