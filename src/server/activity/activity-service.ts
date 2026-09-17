import "server-only";

import type {
  ActivityRepository,
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
    wishId: source.wishId,
    wishTitle: source.wishTitle,
    changedFields: [...source.changes.changedFields],
    addedGroupIds: [...source.changes.addedGroupIds],
    removedGroupIds: [...source.changes.removedGroupIds],
    createdAt: source.createdAt,
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
