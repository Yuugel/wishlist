export type GroupSummary = {
  id: string;
  name: string;
  createdAt: Date;
};

export type GroupMember = {
  id: string;
  displayName: string;
};

export type GroupDetails = GroupSummary & {
  members: GroupMember[];
};

export type GroupDissolvedEvent = {
  groupId: string;
  departedUserId: string;
  remainingMemberIds: string[];
  dissolvedAt: Date;
};

export type JoinGroupResult =
  | { kind: "invalid-invite" }
  | { kind: "joined"; group: GroupSummary }
  | { kind: "already-member"; group: GroupSummary };

export type LeaveGroupResult =
  | { kind: "not-member" }
  | { kind: "left"; group: GroupSummary }
  | { kind: "dissolved"; event: GroupDissolvedEvent };
