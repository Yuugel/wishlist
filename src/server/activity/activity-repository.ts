import type { TakeoverStatus } from "../takeovers/takeover-repository";
import type { WishChangeSet, WishField } from "../wishes/wish-repository";

export const ACTIVITY_LIST_LIMIT = 100;

/** A deliberately small event log for recipient-facing MVP lifecycle events. */
export type ActivityEventType =
  | "wish_changed"
  | "takeover_released_visibility_lost"
  | "wish_deleted"
  | "group_dissolved";

export type WishChangedActivityInput = {
  recipientId: string;
  eventType: "wish_changed";
  wishId: string;
  wishTitle: string;
  takeoverStatus: null;
  groupName: null;
  changedFields: WishField[];
  addedGroupIds: string[];
  removedGroupIds: string[];
  createdAt: Date;
};

export type TakeoverLifecycleActivityInput = {
  recipientId: string;
  eventType: "takeover_released_visibility_lost" | "wish_deleted";
  wishId: string;
  wishTitle: string;
  takeoverStatus: TakeoverStatus;
  groupName: null;
  changedFields: [];
  addedGroupIds: [];
  removedGroupIds: [];
  createdAt: Date;
};

export type GroupDissolvedActivityInput = {
  recipientId: string;
  eventType: "group_dissolved";
  wishId: null;
  wishTitle: null;
  takeoverStatus: null;
  groupName: string;
  changedFields: [];
  addedGroupIds: [];
  removedGroupIds: [];
  createdAt: Date;
};

export type ActivityInput =
  | WishChangedActivityInput
  | TakeoverLifecycleActivityInput
  | GroupDissolvedActivityInput;

export type ActivityRecord = {
  id: string;
  recipientId: string;
  eventType: ActivityEventType;
  wishId: string | null;
  wishTitle: string | null;
  takeoverStatus: TakeoverStatus | null;
  groupName: string | null;
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
