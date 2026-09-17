import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { describe, it } from "node:test";
import type {
  CreateGroupInput,
  CreateInviteInput,
  GroupRepository,
  JoinGroupInput,
  LeaveGroupInput,
} from "./group-repository";
import { createGroupService, GroupServiceError } from "./group-service";
import type {
  GroupDetails,
  GroupSummary,
  JoinGroupResult,
  LeaveGroupResult,
} from "./group-types";

class MemoryGroupRepository implements GroupRepository {
  private nextGroupId = 1;
  private readonly groups = new Map<
    string,
    {
      summary: GroupSummary;
      memberIds: string[];
      invites: Array<{
        selector: string;
        digest: Buffer;
        expiresAt: Date;
      }>;
    }
  >();
  private readonly displayNames = new Map<string, string>();

  addUser(userId: string, displayName = userId): void {
    this.displayNames.set(userId, displayName);
  }

  hasGroup(groupId: string): boolean {
    return this.groups.has(groupId);
  }

  memberIds(groupId: string): string[] {
    return [...(this.groups.get(groupId)?.memberIds ?? [])];
  }

  inviteCount(groupId: string): number {
    return this.groups.get(groupId)?.invites.length ?? 0;
  }

  async createGroupWithMember(input: CreateGroupInput): Promise<GroupSummary> {
    this.addUser(input.userId);
    const id = `group-${this.nextGroupId++}`;
    const summary = { id, name: input.groupName, createdAt: input.now };
    this.groups.set(id, {
      summary,
      memberIds: [input.userId],
      invites: [],
    });
    return summary;
  }

  async listGroupsForMember(userId: string): Promise<GroupSummary[]> {
    return [...this.groups.values()]
      .filter((group) => group.memberIds.includes(userId))
      .map((group) => group.summary);
  }

  async getGroupForMember(
    groupId: string,
    userId: string,
  ): Promise<GroupDetails | null> {
    const group = this.groups.get(groupId);
    if (!group || !group.memberIds.includes(userId)) return null;

    return {
      ...group.summary,
      members: group.memberIds.map((id) => ({
        id,
        displayName: this.displayNames.get(id) ?? id,
      })),
    };
  }

  async createInviteForMember(
    input: CreateInviteInput,
  ): Promise<{ expiresAt: Date } | null> {
    const group = this.groups.get(input.groupId);
    if (!group || !group.memberIds.includes(input.userId)) return null;

    group.invites.push({
      selector: input.selector,
      digest: Buffer.from(input.digest),
      expiresAt: input.expiresAt,
    });
    return { expiresAt: input.expiresAt };
  }

  async joinWithInvite(input: JoinGroupInput): Promise<JoinGroupResult> {
    const group = [...this.groups.values()].find((candidate) =>
      candidate.invites.some((invite) => invite.selector === input.selector),
    );
    if (!group) return { kind: "invalid-invite" };

    const invite = group.invites.find(
      (candidate) => candidate.selector === input.selector,
    );
    if (
      !invite ||
      invite.expiresAt.getTime() <= input.now.getTime() ||
      !timingSafeEqual(invite.digest, Buffer.from(input.inviteDigest))
    ) {
      return { kind: "invalid-invite" };
    }

    if (group.memberIds.includes(input.userId)) {
      return { kind: "already-member", group: group.summary };
    }

    this.addUser(input.userId);
    group.memberIds.push(input.userId);
    return { kind: "joined", group: group.summary };
  }

  async leaveGroup(input: LeaveGroupInput): Promise<LeaveGroupResult> {
    const group = this.groups.get(input.groupId);
    if (!group) return { kind: "not-member" };

    const memberIndex = group.memberIds.indexOf(input.userId);
    if (memberIndex < 0) return { kind: "not-member" };
    group.memberIds.splice(memberIndex, 1);

    if (group.memberIds.length <= 1) {
      this.groups.delete(input.groupId);
      return {
        kind: "dissolved",
        event: {
          groupId: input.groupId,
          departedUserId: input.userId,
          remainingMemberIds: [...group.memberIds],
          dissolvedAt: input.now,
        },
      };
    }

    return { kind: "left", group: group.summary };
  }
}

function isServiceError(code: GroupServiceError["code"]) {
  return (error: unknown): boolean =>
    error instanceof GroupServiceError && error.code === code;
}

describe("group service", () => {
  it("creates a group with the creator as an ordinary member", async () => {
    const repository = new MemoryGroupRepository();
    const service = createGroupService(repository);
    const now = new Date("2026-09-17T00:00:00.000Z");

    const group = await service.createGroup({
      userId: "alice",
      name: "  Family  ",
      now,
    });

    assert.equal(group.name, "Family");
    assert.deepEqual(repository.memberIds(group.id), ["alice"]);
    assert.deepEqual(await service.listGroups({ userId: "alice" }), [group]);
  });

  it("authorizes invites and joins, while preventing duplicate membership", async () => {
    const repository = new MemoryGroupRepository();
    const service = createGroupService(repository);
    const now = new Date("2026-09-17T00:00:00.000Z");
    const group = await service.createGroup({
      userId: "alice",
      name: "Friends",
      now,
    });

    await assert.rejects(
      service.createInvite({ groupId: group.id, userId: "outsider", now }),
      isServiceError("group_access_denied"),
    );

    const invite = await service.createInvite({
      groupId: group.id,
      userId: "alice",
      now,
    });
    assert.equal(repository.inviteCount(group.id), 1);
    assert.match(invite.token, /^wgi1_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);

    const joined = await service.joinGroup({
      token: invite.token,
      userId: "bob",
      now,
    });
    assert.equal(joined.joined, true);
    assert.deepEqual(repository.memberIds(group.id), ["alice", "bob"]);

    const repeated = await service.joinGroup({
      token: invite.token,
      userId: "bob",
      now,
    });
    assert.equal(repeated.joined, false);
    assert.deepEqual(repository.memberIds(group.id), ["alice", "bob"]);
  });

  it("rejects malformed and expired invites", async () => {
    const repository = new MemoryGroupRepository();
    const service = createGroupService(repository);
    const now = new Date("2026-09-17T00:00:00.000Z");
    const group = await service.createGroup({
      userId: "alice",
      name: "Expired",
      now,
    });
    const invite = await service.createInvite({
      groupId: group.id,
      userId: "alice",
      now,
    });

    await assert.rejects(
      service.joinGroup({
        token: `${invite.token}x`,
        userId: "bob",
        now,
      }),
      isServiceError("invalid_invite"),
    );
    await assert.rejects(
      service.joinGroup({
        token: invite.token,
        userId: "bob",
        now: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000 + 1),
      }),
      isServiceError("invalid_invite"),
    );
  });

  it("exposes members only to members and only permits self-leave", async () => {
    const repository = new MemoryGroupRepository();
    const service = createGroupService(repository);
    const now = new Date("2026-09-17T00:00:00.000Z");
    const group = await service.createGroup({
      userId: "alice",
      name: "Visible",
      now,
    });
    const invite = await service.createInvite({
      groupId: group.id,
      userId: "alice",
      now,
    });
    await service.joinGroup({ token: invite.token, userId: "bob", now });
    await service.joinGroup({ token: invite.token, userId: "carol", now });

    const details = await service.getGroup({
      groupId: group.id,
      userId: "bob",
    });
    assert.deepEqual(
      details.members.map((member) => member.displayName),
      ["alice", "bob", "carol"],
    );
    assert.equal("email" in details.members[0]!, false);
    await assert.rejects(
      service.getGroup({ groupId: group.id, userId: "outsider" }),
      isServiceError("group_access_denied"),
    );

    const left = await service.leaveGroup({
      groupId: group.id,
      userId: "bob",
      now,
    });
    assert.equal(left.dissolved, false);
    assert.deepEqual(repository.memberIds(group.id), ["alice", "carol"]);
  });

  it("dissolves a group at one remaining member and emits the lifecycle hook", async () => {
    const repository = new MemoryGroupRepository();
    const events: string[] = [];
    const service = createGroupService(repository, {
      onGroupDissolved: (event) => {
        events.push(
          `${event.groupId}:${event.departedUserId}:${event.remainingMemberIds.join(",")}`,
        );
      },
    });
    const now = new Date("2026-09-17T00:00:00.000Z");
    const group = await service.createGroup({
      userId: "alice",
      name: "Temporary",
      now,
    });
    const invite = await service.createInvite({
      groupId: group.id,
      userId: "alice",
      now,
    });
    await service.joinGroup({ token: invite.token, userId: "bob", now });

    const result = await service.leaveGroup({
      groupId: group.id,
      userId: "alice",
      now,
    });

    assert.equal(result.dissolved, true);
    assert.equal(repository.hasGroup(group.id), false);
    assert.deepEqual(repository.memberIds(group.id), []);
    assert.equal(repository.inviteCount(group.id), 0);
    assert.deepEqual(events, [`${group.id}:alice:bob`]);
    await assert.rejects(
      service.getGroup({ groupId: group.id, userId: "bob" }),
      isServiceError("group_access_denied"),
    );
  });
});
