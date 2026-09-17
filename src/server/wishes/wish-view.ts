import "server-only";

import type { GroupSummary } from "../groups/group-types";
import type { WishRecord, WishVisibilityRecord } from "./wish-repository";

export type WishSafeViewFields = {
  id: string;
  title: string;
  description: string | null;
  link: string | null;
  priceText: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Owner-facing data for the personal wish list. This is intentionally a
 * dedicated DTO instead of a repository row so future takeover data cannot be
 * added to the owner response by accident.
 */
export type OwnerWishView = WishSafeViewFields & {
  audience: "owner";
  groups: GroupSummary[];
};

/** Owner-safe data when the owner's wish is rendered in one group. */
export type GroupOwnerWishView = WishSafeViewFields & {
  audience: "owner";
};

/**
 * Data for another group member. Future reservation/takeover information may
 * be added to this type without changing the owner-facing DTOs.
 */
export type GroupViewerWishView = WishSafeViewFields & {
  audience: "viewer";
};

export type GroupWishView = GroupOwnerWishView | GroupViewerWishView;

function safeFields(wish: WishRecord | WishVisibilityRecord): WishSafeViewFields {
  return {
    id: wish.id,
    title: wish.title,
    description: wish.description,
    link: wish.link,
    priceText: wish.priceText,
    createdAt: wish.createdAt,
    updatedAt: wish.updatedAt,
  };
}

export function toOwnerWishView(wish: WishRecord): OwnerWishView {
  return {
    ...safeFields(wish),
    audience: "owner",
    groups: wish.groups.map((group) => ({ ...group })),
  };
}

export function toGroupOwnerWishView(
  wish: WishVisibilityRecord,
): GroupOwnerWishView {
  return { ...safeFields(wish), audience: "owner" };
}

export function toGroupViewerWishView(
  wish: WishVisibilityRecord,
): GroupViewerWishView {
  return { ...safeFields(wish), audience: "viewer" };
}

function serializeSafeFields(view: WishSafeViewFields) {
  return {
    id: view.id,
    title: view.title,
    description: view.description,
    link: view.link,
    priceText: view.priceText,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

function serializeGroup(group: GroupSummary) {
  return {
    id: group.id,
    name: group.name,
    createdAt: group.createdAt.toISOString(),
  };
}

export function serializeOwnerWishView(view: OwnerWishView) {
  return {
    view: view.audience,
    ...serializeSafeFields(view),
    groups: view.groups.map(serializeGroup),
  };
}

export function serializeGroupWishView(view: GroupWishView) {
  return {
    view: view.audience,
    ...serializeSafeFields(view),
  };
}
