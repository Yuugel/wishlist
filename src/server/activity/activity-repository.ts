import type { TakeoverStatus } from "../takeovers/takeover-repository";
import type { WishChangeSet, WishField } from "../wishes/wish-repository";

export const ACTIVITY_LIST_LIMIT = 100;

/**
 * Activity is intentionally a small, typed event log. New domain events can
 * extend this union and the table in a later additive migration without
 * introducing a separate notification platform.
 */
export type ActivityEventType = "wish_changed";

export type WishChangedActivityInput = {
  recipientId: string;
  wishId: string;
  wishTitle: string;
  changedFields: WishField[];
  addedGroupIds: string[];
  removedGroupIds: string[];
  createdAt: Date;
};

export type ActivityRecord = {
  id: string;
  recipientId: string;
  eventType: ActivityEventType;
  wishId: string | null;
  wishTitle: string;
  changedFields: WishField[];
  addedGroupIds: string[];
  removedGroupIds: string[];
  createdAt: Date;
};

export interface ActivityRepository {
  listForRecipient(recipientId: string): Promise<ActivityRecord[]>;
}

export type WishChangeActivitySource = {
  activeTakeover: {
    takerId: string;
    status: TakeoverStatus;
  } | null;
  wishId: string;
  wishTitle: string;
  changes: WishChangeSet;
  createdAt: Date;
};
