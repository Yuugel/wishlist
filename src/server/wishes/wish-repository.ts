import type { GroupSummary } from "../groups/group-types";

export type WishField = "title" | "description" | "link" | "priceText";

export type WishValues = {
  title: string;
  description: string | null;
  link: string | null;
  priceText: string | null;
};

export type WishRecord = WishValues & {
  id: string;
  ownerId: string;
  groups: GroupSummary[];
  createdAt: Date;
  updatedAt: Date;
};

export type WishChangeSet = {
  changedFields: WishField[];
  addedGroupIds: string[];
  removedGroupIds: string[];
  isNoop: boolean;
};

export type CreateWishRepositoryInput = {
  ownerId: string;
  values: WishValues;
  groupIds: string[];
  now: Date;
};

export type UpdateWishRepositoryInput = {
  wishId: string;
  ownerId: string;
  values: Partial<WishValues>;
  groupIds?: string[];
  now: Date;
};

export type CreateWishResult =
  | { kind: "created"; wish: WishRecord }
  | { kind: "invalid-groups"; invalidGroupIds: string[] };

export type UpdateWishResult =
  | { kind: "updated"; wish: WishRecord; changes: WishChangeSet }
  | { kind: "not-found" }
  | { kind: "invalid-groups"; invalidGroupIds: string[] };

export interface WishRepository {
  createWish(input: CreateWishRepositoryInput): Promise<CreateWishResult>;
  listWishesForOwner(ownerId: string): Promise<WishRecord[]>;
  updateWish(input: UpdateWishRepositoryInput): Promise<UpdateWishResult>;
  deleteWish(input: { wishId: string; ownerId: string }): Promise<boolean>;
}

export type WishGroup = GroupSummary;
