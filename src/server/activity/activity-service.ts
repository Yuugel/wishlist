import "server-only";

import type {
  ActivityRepository,
  GroupDissolvedActivityInput,
  TakeoverLifecycleActivityInput,
  WishChangedActivityInput,
  WishChangeActivitySource,
} from "./activity-repository";

export type ActivityServiceErrorCode = "activity_access_denied";

export class ActivityServiceError extends Error {
  constructor(
    public readonly code: ActivityServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ActivityServiceError";
  }
}

function requireActor(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ActivityServiceError(
      "activity_access_denied",
      "Ein authentifizierter Nutzer ist erforderlich.",
    );
  }
  return value.trim();
}

/**
 * Build the one persisted event for a successful, non-no-op wish update.
 * Keeping this decision in one place prevents field-level notifications from
 * being emitted as a separate event for each changed value.
 */
export function createWishChangedActivity(
  source: WishChangeActivitySource,
): WishChangedActivityInput | null {
  if (!source.activeTakeover || source.changes.isNoop) return null;
  if (
    source.activeTakeover.status !== "reserved" &&
    source.activeTakeover.status !== "purchased"
  ) {
    return null;
  }

  return {
    recipientId: source.activeTakeover.takerId,
    eventType: "wish_changed",
    wishId: source.wishId,
    wishTitle: source.wishTitle,
    takeoverStatus: null,
    groupName: null,
    changedFields: [...source.changes.changedFields],
    addedGroupIds: [...source.changes.addedGroupIds],
    removedGroupIds: [...source.changes.removedGroupIds],
    createdAt: source.createdAt,
  };
}

export function createTakeoverReleasedActivity(input: {
  recipientId: string;
  wishId: string;
  wishTitle: string;
  takeoverStatus: "reserved" | "purchased";
  createdAt: Date;
}): TakeoverLifecycleActivityInput {
  return {
    ...input,
    eventType: "takeover_released_visibility_lost",
    groupName: null,
    changedFields: [],
    addedGroupIds: [],
    removedGroupIds: [],
  };
}

export function createWishDeletedActivity(input: {
  recipientId: string;
  wishId: string;
  wishTitle: string;
  takeoverStatus: "reserved" | "purchased";
  createdAt: Date;
}): TakeoverLifecycleActivityInput {
  return {
    ...input,
    eventType: "wish_deleted",
    groupName: null,
    changedFields: [],
    addedGroupIds: [],
    removedGroupIds: [],
  };
}

export function createGroupDissolvedActivity(input: {
  recipientId: string;
  groupName: string;
  createdAt: Date;
}): GroupDissolvedActivityInput {
  return {
    ...input,
    eventType: "group_dissolved",
    wishId: null,
    wishTitle: null,
    takeoverStatus: null,
    changedFields: [],
    addedGroupIds: [],
    removedGroupIds: [],
  };
}

export function createActivityService(repository: ActivityRepository) {
  return {
    async listActivities(input: { userId: string }) {
      return repository.listForRecipient(requireActor(input.userId));
    },
  };
}

export type ActivityService = ReturnType<typeof createActivityService>;
export type { ActivityRecord } from "./activity-repository";
