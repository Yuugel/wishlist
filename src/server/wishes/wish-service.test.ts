import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GroupSummary } from "../groups/group-types";
import type {
  CreateWishRepositoryInput,
  UpdateWishRepositoryInput,
  UpdateWishResult,
  WishRecord,
  WishRepository,
} from "./wish-repository";
import {
  createWishService,
  WishServiceError,
} from "./wish-service";

class MemoryWishRepository implements WishRepository {
  private nextWishId = 1;
  private readonly wishes = new Map<string, WishRecord>();
  private readonly groups = new Map<
    string,
    { summary: GroupSummary; memberIds: Set<string> }
  >();

  addGroup(id: string, memberIds: string[]): GroupSummary {
    const summary = {
      id,
      name: id,
      createdAt: new Date("2026-09-17T00:00:00.000Z"),
    };
    this.groups.set(id, { summary, memberIds: new Set(memberIds) });
    return summary;
  }

  wishCount(): number {
    return this.wishes.size;
  }

  groupIdsForWish(wishId: string): string[] {
    return [...(this.wishes.get(wishId)?.groups ?? [])]
      .map((group) => group.id)
      .sort();
  }

  private groupsForIds(groupIds: string[]): GroupSummary[] {
    return groupIds.map((groupId) => this.groups.get(groupId)!.summary);
  }

  private hasMembership(ownerId: string, groupIds: string[]): string[] {
    return groupIds.filter(
      (groupId) => !this.groups.get(groupId)?.memberIds.has(ownerId),
    );
  }

  private copy(wish: WishRecord): WishRecord {
    return {
      ...wish,
      groups: wish.groups.map((group) => ({ ...group })),
    };
  }

  async createWish(input: CreateWishRepositoryInput) {
    const invalidGroupIds = this.hasMembership(input.ownerId, input.groupIds);
    if (invalidGroupIds.length > 0) {
      return { kind: "invalid-groups" as const, invalidGroupIds };
    }

    const id = `wish-${this.nextWishId++}`;
    const wish: WishRecord = {
      id,
      ownerId: input.ownerId,
      ...input.values,
      groups: this.groupsForIds(input.groupIds),
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.wishes.set(id, wish);
    return { kind: "created" as const, wish: this.copy(wish) };
  }

  async listWishesForOwner(ownerId: string): Promise<WishRecord[]> {
    return [...this.wishes.values()]
      .filter((wish) => wish.ownerId === ownerId)
      .map((wish) => this.copy(wish));
  }

  async updateWish(input: UpdateWishRepositoryInput): Promise<UpdateWishResult> {
    const wish = this.wishes.get(input.wishId);
    if (!wish || wish.ownerId !== input.ownerId) return { kind: "not-found" };

    if (input.groupIds !== undefined) {
      const invalidGroupIds = this.hasMembership(
        input.ownerId,
        input.groupIds,
      );
      if (invalidGroupIds.length > 0) {
        return { kind: "invalid-groups", invalidGroupIds };
      }
    }

    const currentGroupIds = wish.groups.map((group) => group.id).sort();
    const targetGroupIds = input.groupIds ?? currentGroupIds;
    const currentGroupSet = new Set(currentGroupIds);
    const targetGroupSet = new Set(targetGroupIds);
    const addedGroupIds = targetGroupIds.filter(
      (groupId) => !currentGroupSet.has(groupId),
    );
    const removedGroupIds = currentGroupIds.filter(
      (groupId) => !targetGroupSet.has(groupId),
    );
    const changedFields = (Object.keys(input.values) as Array<
      keyof typeof input.values
    >).filter((field) => input.values[field] !== wish[field]);
    const changes = {
      changedFields,
      addedGroupIds,
      removedGroupIds,
      isNoop:
        changedFields.length === 0 &&
        addedGroupIds.length === 0 &&
        removedGroupIds.length === 0,
    };

    if (!changes.isNoop) {
      Object.assign(wish, input.values, {
        groups: this.groupsForIds(targetGroupIds),
        updatedAt: input.now,
      });
    }

    return { kind: "updated", wish: this.copy(wish), changes };
  }

  async deleteWish(input: { wishId: string; ownerId: string }): Promise<boolean> {
    const wish = this.wishes.get(input.wishId);
    if (!wish || wish.ownerId !== input.ownerId) return false;
    this.wishes.delete(input.wishId);
    return true;
  }
}

function serviceError(code: WishServiceError["code"]) {
  return (error: unknown): boolean =>
    error instanceof WishServiceError && error.code === code;
}

describe("wish service", () => {
  const now = new Date("2026-09-17T00:00:00.000Z");

  it("creates a private wish with only a title and normalizes optional fields", async () => {
    const repository = new MemoryWishRepository();
    const service = createWishService(repository);

    const wish = await service.createWish({
      ownerId: "alice",
      title: "  Konzertkarten  ",
      description: "   ",
      link: "",
      priceText: null,
      now,
    });

    assert.equal(wish.title, "Konzertkarten");
    assert.equal(wish.description, null);
    assert.equal(wish.link, null);
    assert.equal(wish.priceText, null);
    assert.deepEqual(wish.groups, []);
  });

  it("creates one wish with all MVP fields and multiple group assignments", async () => {
    const repository = new MemoryWishRepository();
    repository.addGroup("group-a", ["alice"]);
    repository.addGroup("group-b", ["alice"]);
    const service = createWishService(repository);

    const wish = await service.createWish({
      ownerId: "alice",
      title: "Kopfhörer",
      description: "Noise cancelling",
      link: "https://example.test/item",
      priceText: "99,00 €",
      groupIds: ["group-b", "group-a", "group-a"],
      now,
    });

    assert.equal(repository.wishCount(), 1);
    assert.deepEqual(repository.groupIdsForWish(wish.id), ["group-a", "group-b"]);
    assert.equal(wish.groups.length, 2);
  });

  it("rejects unknown and non-member group assignments", async () => {
    const repository = new MemoryWishRepository();
    repository.addGroup("group-a", ["alice"]);
    repository.addGroup("group-b", ["bob"]);
    const service = createWishService(repository);

    await assert.rejects(
      service.createWish({
        ownerId: "alice",
        title: "Privat",
        groupIds: ["group-b"],
        now,
      }),
      serviceError("invalid_group_ids"),
    );
    await assert.rejects(
      service.createWish({
        ownerId: "alice",
        title: "Unbekannt",
        groupIds: ["missing"],
        now,
      }),
      serviceError("invalid_group_ids"),
    );
    assert.equal(repository.wishCount(), 0);
  });

  it("allows only the owner to edit fields and atomically add/remove groups", async () => {
    const repository = new MemoryWishRepository();
    repository.addGroup("group-a", ["alice"]);
    repository.addGroup("group-b", ["alice"]);
    const service = createWishService(repository);
    const wish = await service.createWish({
      ownerId: "alice",
      title: "Buch",
      groupIds: ["group-a"],
      now,
    });

    await assert.rejects(
      service.updateWish({
        wishId: wish.id,
        ownerId: "bob",
        title: "Fremdänderung",
        now,
      }),
      serviceError("wish_access_denied"),
    );

    const result = await service.updateWish({
      wishId: wish.id,
      ownerId: "alice",
      description: "Neue Notiz",
      groupIds: ["group-b"],
      now: new Date(now.getTime() + 1),
    });
    assert.deepEqual(result.changes.changedFields, ["description"]);
    assert.deepEqual(result.changes.addedGroupIds, ["group-b"]);
    assert.deepEqual(result.changes.removedGroupIds, ["group-a"]);
    assert.equal(result.changes.isNoop, false);
    assert.deepEqual(repository.groupIdsForWish(wish.id), ["group-b"]);
  });

  it("reports field, assignment, and no-op changes without artificial updates", async () => {
    const repository = new MemoryWishRepository();
    repository.addGroup("group-a", ["alice"]);
    const service = createWishService(repository);
    const wish = await service.createWish({
      ownerId: "alice",
      title: "Lampe",
      groupIds: ["group-a"],
      now,
    });

    const noOp = await service.updateWish({
      wishId: wish.id,
      ownerId: "alice",
      title: " Lampe ",
      description: "",
      groupIds: ["group-a", "group-a"],
      now: new Date(now.getTime() + 1),
    });
    assert.equal(noOp.changes.isNoop, true);
    assert.deepEqual(noOp.changes.changedFields, []);
    assert.deepEqual(noOp.changes.addedGroupIds, []);
    assert.deepEqual(noOp.changes.removedGroupIds, []);
    assert.equal(noOp.wish.updatedAt.getTime(), now.getTime());
  });

  it("lists private and grouped wishes together and protects deletion", async () => {
    const repository = new MemoryWishRepository();
    repository.addGroup("group-a", ["alice"]);
    const service = createWishService(repository);
    const privateWish = await service.createWish({
      ownerId: "alice",
      title: "Privat",
      now,
    });
    await service.createWish({
      ownerId: "alice",
      title: "Gruppe",
      groupIds: ["group-a"],
      now,
    });

    assert.equal((await service.listWishes({ ownerId: "alice" })).length, 2);
    await assert.rejects(
      service.deleteWish({ wishId: privateWish.id, ownerId: "bob" }),
      serviceError("wish_access_denied"),
    );
    assert.equal(await service.deleteWish({ wishId: privateWish.id, ownerId: "alice" }), true);
    assert.equal((await service.listWishes({ ownerId: "alice" })).length, 1);
  });
});
