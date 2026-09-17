import type { GroupRepository } from "../groups/group-repository";
import type { TakeoverStatus } from "../takeovers/takeover-repository";
import type { WishVisibilityRecord } from "../wishes/wish-repository";

export type GroupWishRecord = WishVisibilityRecord & {
  /** The group constraint applied by the visibility query. */
  groupId: string;
  /** Internal projection only; never serialize this record directly. */
  takeoverStatus: TakeoverStatus | null;
  /** Used only to derive `*_by_you`; never included in a viewer DTO. */
  takeoverTakerId: string | null;
};

export type VisibilityRepository = Pick<
  GroupRepository,
  "getGroupForMember"
> & {
  /** Returns null when the viewer is not a current member of the group. */
  listWishesForMemberInGroup(
    groupId: string,
    userId: string,
  ): Promise<GroupWishRecord[] | null>;
};
