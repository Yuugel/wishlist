import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GroupDetails, GroupSummary } from "../groups/group-types";
import type {
  GroupWishRecord,
  VisibilityRepository,
} from "./visibility-repository";
import { createVisibilityService } from "./visibility-service";
import { GroupServiceError } from "../groups/group-service";

class MemoryVisibilityRepository implements VisibilityRepository {
  private readonly groups = new Map<
    string,
    { details: GroupDetails; memberIds: Set<string> }
  >();
  private readonly wishes: GroupWishRecord[] = [];
  private readonly takeovers = new Map<
    string,
    { status: "reserved" | "purchased"; takerId: string }
  >();

  addGroup(
    id: string,
    name: string,
    members: Array<{ id: string; displayName?: string }>,
  ): GroupSummary {
    const summary = {
      id,
      name,
      createdAt: new Date("2026-09-17T00:00:00.000Z"),
    };
    const details: GroupDetails = {
      ...summary,
      members: members.map((member) => ({
        id: member.id,
        displayName: member.displayName ?? member.id,
      })),
    };
    this.groups.set(id, {
      details,
      memberIds: new Set(members.map((member) => member.id)),
    });
    return summary;
  }

  addWish(input: {
    id: string;
    ownerId: string;
    title: string;
    groupIds: string[];
  }): void {
    for (const groupId of input.groupIds) {
      this.wishes.push({
        groupId,
        id: input.id,
        ownerId: input.ownerId,
        title: input.title,
        description: null,
        link: null,
        priceText: null,
        createdAt: new Date("2026-09-17T00:00:00.000Z"),
        updatedAt: new Date("2026-09-17T00:00:00.000Z"),
        takeoverStatus: null,
        takeoverTakerId: null,
      });
    }
  }

  setTakeover(
    wishId: string,
    status: "reserved" | "purchased",
    takerId: string,
  ): void {
    this.takeovers.set(wishId, { status, takerId });
  }

  async getGroupForMember(
    groupId: string,
    userId: string,
  ): Promise<GroupDetails | null> {
    const group = this.groups.get(groupId);
    return group?.memberIds.has(userId) ? group.details : null;
  }

  async listWishesForMemberInGroup(
    groupId: string,
    userId: string,
  ): Promise<GroupWishRecord[] | null> {
    const group = this.groups.get(groupId);
    if (!group?.memberIds.has(userId)) return null;
    return this.wishes
      .filter((wish) => wish.groupId === groupId)
      .map((wish) => {
        const takeover = this.takeovers.get(wish.id);
        return {
          ...wish,
          takeoverStatus: takeover?.status ?? null,
          takeoverTakerId: takeover?.takerId ?? null,
        };
      });
  }
}

function isAccessDenied(error: unknown): boolean {
  return (
    error instanceof GroupServiceError && error.code === "group_access_denied"
  );
}

describe("group visibility service", () => {
  it("authorizes group reads and filters wishes by the exact group", async () => {
    const repository = new MemoryVisibilityRepository();
    repository.addGroup("group-a", "A", [
      { id: "alice", displayName: "Alice" },
      { id: "bob", displayName: "Bob" },
      { id: "charlie", displayName: "Charlie" },
    ]);
    repository.addGroup("group-b", "B", [
      { id: "alice", displayName: "Alice" },
      { id: "bob", displayName: "Bob" },
      { id: "charlie", displayName: "Charlie" },
    ]);
    repository.addWish({
      id: "wish-shared",
      ownerId: "bob",
      title: "In beiden Gruppen",
      groupIds: ["group-a", "group-b"],
    });
    repository.addWish({
      id: "wish-a",
      ownerId: "bob",
      title: "Nur A",
      groupIds: ["group-a"],
    });
    repository.addWish({
      id: "wish-b",
      ownerId: "bob",
      title: "Nur B",
      groupIds: ["group-b"],
    });
    repository.addWish({
      id: "wish-private",
      ownerId: "bob",
      title: "Privat",
      groupIds: [],
    });
    repository.addWish({
      id: "wish-own",
      ownerId: "alice",
      title: "Eigener Wunsch in A",
      groupIds: ["group-a"],
    });
    repository.setTakeover("wish-shared", "reserved", "alice");
    // Deliberately attach a secret to an owner record: the owner projection
    // must still discard it completely.
    repository.setTakeover("wish-own", "purchased", "bob");

    const service = createVisibilityService(repository);
    const groupA = await service.getGroup({
      groupId: "group-a",
      userId: "alice",
    });
    assert.deepEqual(
      groupA.members.map((member) => member.displayName),
      ["Alice", "Bob", "Charlie"],
    );

    const visibleA = await service.listGroupWishes({
      groupId: "group-a",
      userId: "alice",
    });
    const bobWishes = visibleA.members.find(
      (entry) => entry.member.id === "bob",
    )?.wishes;
    const aliceWishes = visibleA.members.find(
      (entry) => entry.member.id === "alice",
    )?.wishes;

    assert.deepEqual(
      bobWishes?.map((wish) => wish.id).sort(),
      ["wish-a", "wish-shared"],
    );
    assert.deepEqual(aliceWishes?.map((wish) => wish.id), ["wish-own"]);
    assert.equal(aliceWishes?.[0]?.audience, "owner");
    assert.equal(bobWishes?.[0]?.audience, "viewer");
    assert.equal("ownerId" in (bobWishes?.[0] ?? {}), false);
    assert.equal("groups" in (bobWishes?.[0] ?? {}), false);
    assert.equal("reservation" in (bobWishes?.[0] ?? {}), false);
    assert.equal("takeoverTakerId" in (bobWishes?.[0] ?? {}), false);
    const sharedForAlice = bobWishes?.find(
      (wish) => wish.id === "wish-shared",
    );
    assert.equal(
      sharedForAlice?.audience === "viewer"
        ? sharedForAlice.takeoverStatus
        : undefined,
      "reserved_by_you",
    );
    assert.equal("takeoverStatus" in (aliceWishes?.[0] ?? {}), false);

    const visibleB = await service.listGroupWishes({
      groupId: "group-b",
      userId: "alice",
    });
    assert.deepEqual(
      visibleB.members.find((entry) => entry.member.id === "bob")?.wishes.map(
        (wish) => wish.id,
      ),
      ["wish-shared", "wish-b"],
    );
    const sharedInA = visibleA.members
      .flatMap((entry) => entry.wishes)
      .find((wish) => wish.id === "wish-shared");
    const sharedInB = visibleB.members
      .flatMap((entry) => entry.wishes)
      .find((wish) => wish.id === "wish-shared");
    assert.equal(sharedInA?.id, sharedInB?.id);
    assert.equal(
      sharedInA?.audience === "viewer" ? sharedInA.takeoverStatus : undefined,
      "reserved_by_you",
    );
    assert.equal(
      sharedInB?.audience === "viewer" ? sharedInB.takeoverStatus : undefined,
      "reserved_by_you",
    );

    const visibleForOtherViewer = await service.listGroupWishes({
      groupId: "group-a",
      userId: "charlie",
    });
    const sharedForOtherViewer = visibleForOtherViewer.members
      .flatMap((entry) => entry.wishes)
      .find((wish) => wish.id === "wish-shared");
    assert.equal(
      sharedForOtherViewer?.audience === "viewer"
        ? sharedForOtherViewer.takeoverStatus
        : undefined,
      "reserved",
    );
    assert.equal("takeoverTakerId" in (sharedForOtherViewer ?? {}), false);

    await assert.rejects(
      service.getGroup({ groupId: "group-a", userId: "outsider" }),
      isAccessDenied,
    );
    await assert.rejects(
      service.listGroupWishes({ groupId: "group-a", userId: "outsider" }),
      isAccessDenied,
    );
    await assert.rejects(
      service.listGroupWishes({ groupId: "group-b", userId: "outsider" }),
      isAccessDenied,
    );
  });
});
