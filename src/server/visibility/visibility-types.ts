import type { GroupMember } from "../groups/group-types";
import type { GroupWishView } from "../wishes/wish-view";

export type GroupMemberWishViews = {
  member: GroupMember;
  wishes: GroupWishView[];
};

export type GroupWishVisibility = {
  groupId: string;
  members: GroupMemberWishViews[];
};
