import type {
  GroupDissolvedEvent,
  GroupDetails,
  GroupSummary,
  JoinGroupResult,
  LeaveGroupResult,
} from "./group-types";

export type CreateGroupInput = {
  groupName: string;
  userId: string;
  now: Date;
};

export type CreateInviteInput = {
  groupId: string;
  userId: string;
  selector: string;
  digest: Uint8Array;
  expiresAt: Date;
  now: Date;
};

export type JoinGroupInput = {
  selector: string;
  inviteDigest: Uint8Array;
  userId: string;
  now: Date;
};

export type LeaveGroupInput = {
  groupId: string;
  userId: string;
  now: Date;
};

/**
 * The service depends on this small boundary instead of Drizzle primitives.
 * The production implementation keeps authorization checks and mutations in
 * PostgreSQL transactions; tests can exercise the same domain rules without a
 * live database.
 */
export interface GroupRepository {
  createGroupWithMember(input: CreateGroupInput): Promise<GroupSummary>;
  listGroupsForMember(userId: string): Promise<GroupSummary[]>;
  getGroupForMember(
    groupId: string,
    userId: string,
  ): Promise<GroupDetails | null>;
  createInviteForMember(
    input: CreateInviteInput,
  ): Promise<{ expiresAt: Date } | null>;
  joinWithInvite(input: JoinGroupInput): Promise<JoinGroupResult>;
  leaveGroup(input: LeaveGroupInput): Promise<LeaveGroupResult>;
}

export type GroupDissolvedHook = (event: GroupDissolvedEvent) => void | Promise<void>;

export type GroupServiceOptions = {
  onGroupDissolved?: GroupDissolvedHook;
};
