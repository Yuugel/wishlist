import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ReleaseTakeoverResult,
  ReserveTakeoverResult,
  TakeoverMutationInput,
  TakeoverRecord,
  TakeoverRepository,
  TakeoverStatus,
  TransitionTakeoverResult,
  ViewerTakeoverResult,
} from "./takeover-repository";
import {
  createTakeoverService,
  TakeoverServiceError,
} from "./takeover-service";

type MemoryWish = {
  ownerId: string;
  groupIds: string[];
};

class MemoryTakeoverRepository implements TakeoverRepository {
  private readonly wishes = new Map<string, MemoryWish>();
  private readonly memberships = new Map<string, Set<string>>();
  private readonly takeovers = new Map<string, TakeoverRecord>();

  addGroup(groupId: string, memberIds: string[]): void {
    this.memberships.set(groupId, new Set(memberIds));
  }

  addWish(wishId: string, ownerId: string, groupIds: string[]): void {
    this.wishes.set(wishId, { ownerId, groupIds });
  }

  removeMember(groupId: string, userId: string): void {
    this.memberships.get(groupId)?.delete(userId);
  }

  takeoverCount(wishId: string): number {
    return this.takeovers.has(wishId) ? 1 : 0;
  }

  takeoverFor(wishId: string): TakeoverRecord | undefined {
    return this.takeovers.get(wishId);
  }

  private canView(wishId: string, actorId: string): boolean {
    const wish = this.wishes.get(wishId);
    if (!wish || wish.ownerId === actorId) return false;
    return wish.groupIds.some((groupId) => {
      const members = this.memberships.get(groupId);
      return members?.has(wish.ownerId) && members.has(actorId);
    });
  }

  async reserve(input: TakeoverMutationInput): Promise<ReserveTakeoverResult> {
    if (!this.canView(input.wishId, input.actorId)) {
      return { kind: "access-denied" };
    }
    // No await between checking and inserting: this is the memory repository's
    // atomic critical section. PostgreSQL uses the wish_id PK + ON CONFLICT.
    if (this.takeovers.has(input.wishId)) return { kind: "already-taken" };
    const takeover: TakeoverRecord = {
      wishId: input.wishId,
      takerId: input.actorId,
      status: "reserved",
      purchasedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.takeovers.set(input.wishId, takeover);
    return { kind: "reserved", takeover: { ...takeover } };
  }

  async transition(
    input: TakeoverMutationInput & {
      from: TakeoverStatus;
      to: TakeoverStatus;
    },
  ): Promise<TransitionTakeoverResult> {
    if (!this.canView(input.wishId, input.actorId)) {
      return { kind: "access-denied" };
    }
    const takeover = this.takeovers.get(input.wishId);
    if (!takeover || takeover.takerId !== input.actorId) {
      return { kind: "access-denied" };
    }
    if (takeover.status !== input.from) return { kind: "invalid-transition" };
    takeover.status = input.to;
    takeover.purchasedAt = input.to === "purchased" ? input.now : null;
    takeover.updatedAt = input.now;
    return { kind: "transitioned", takeover: { ...takeover } };
  }

  async release(input: TakeoverMutationInput): Promise<ReleaseTakeoverResult> {
    if (!this.canView(input.wishId, input.actorId)) {
      return { kind: "access-denied" };
    }
    const takeover = this.takeovers.get(input.wishId);
    if (!takeover || takeover.takerId !== input.actorId) {
      return { kind: "access-denied" };
    }
    if (takeover.status !== "reserved") return { kind: "invalid-transition" };
    this.takeovers.delete(input.wishId);
    return { kind: "released", takeover: { ...takeover } };
  }

  async getViewerStatus(input: {
    wishId: string;
    actorId: string;
  }): Promise<ViewerTakeoverResult> {
    if (!this.canView(input.wishId, input.actorId)) {
      return { kind: "access-denied" };
    }
    const takeover = this.takeovers.get(input.wishId);
    return {
      kind: "visible",
      status: takeover?.status ?? null,
      isTakenByViewer: takeover?.takerId === input.actorId,
    };
  }
}

function serviceError(code: TakeoverServiceError["code"]) {
  return (error: unknown): boolean =>
    error instanceof TakeoverServiceError && error.code === code;
}

function fixture() {
  const repository = new MemoryTakeoverRepository();
  repository.addGroup("group-a", ["owner", "alice", "bob"]);
  repository.addGroup("group-b", ["owner", "alice", "bob"]);
  repository.addGroup("group-owner-only", ["owner"]);
  repository.addWish("shared", "owner", ["group-a", "group-b"]);
  repository.addWish("private", "owner", []);
  repository.addWish("without-common-group", "owner", ["group-owner-only"]);
  return {
    repository,
    service: createTakeoverService(repository),
    now: new Date("2026-09-17T10:00:00.000Z"),
  };
}

describe("takeover service", () => {
  it("reserves a visible foreign wish globally and exposes identity-safe viewer states", async () => {
    const { repository, service, now } = fixture();

    const reserved = await service.reserveWish({
      wishId: "shared",
      actorId: "alice",
      now,
    });

    assert.equal(reserved.viewerStatus, "reserved_by_you");
    assert.equal(reserved.event.type, "wish_reserved");
    assert.equal(repository.takeoverCount("shared"), 1);
    assert.equal(
      await service.getViewerStatus({ wishId: "shared", actorId: "alice" }),
      "reserved_by_you",
    );
    assert.equal(
      await service.getViewerStatus({ wishId: "shared", actorId: "bob" }),
      "reserved",
    );
  });

  it("denies owners, private wishes, and actors without a current common group", async () => {
    const { service, now } = fixture();

    await assert.rejects(
      service.reserveWish({ wishId: "shared", actorId: "owner", now }),
      serviceError("takeover_access_denied"),
    );
    await assert.rejects(
      service.reserveWish({ wishId: "private", actorId: "alice", now }),
      serviceError("takeover_access_denied"),
    );
    await assert.rejects(
      service.reserveWish({
        wishId: "without-common-group",
        actorId: "alice",
        now,
      }),
      serviceError("takeover_access_denied"),
    );
  });

  it("allows exactly one winner for concurrent attempts and one global row across groups", async () => {
    const { repository, service, now } = fixture();

    const attempts = await Promise.allSettled([
      service.reserveWish({ wishId: "shared", actorId: "alice", now }),
      service.reserveWish({ wishId: "shared", actorId: "bob", now }),
    ]);

    assert.equal(
      attempts.filter((attempt) => attempt.status === "fulfilled").length,
      1,
    );
    assert.equal(
      attempts.filter(
        (attempt) =>
          attempt.status === "rejected" &&
          attempt.reason instanceof TakeoverServiceError &&
          attempt.reason.code === "wish_already_taken",
      ).length,
      1,
    );
    assert.equal(repository.takeoverCount("shared"), 1);
    assert.ok(["alice", "bob"].includes(repository.takeoverFor("shared")!.takerId));
  });

  it("permits only the taker to purchase, roll back, and release in order", async () => {
    const { repository, service, now } = fixture();
    await service.reserveWish({ wishId: "shared", actorId: "alice", now });

    await assert.rejects(
      service.markPurchased({ wishId: "shared", actorId: "bob", now }),
      serviceError("takeover_access_denied"),
    );
    await assert.rejects(
      service.markPurchased({ wishId: "shared", actorId: "owner", now }),
      serviceError("takeover_access_denied"),
    );

    const purchasedAt = new Date(now.getTime() + 1);
    const purchased = await service.markPurchased({
      wishId: "shared",
      actorId: "alice",
      now: purchasedAt,
    });
    assert.equal(purchased.viewerStatus, "purchased_by_you");
    assert.equal(repository.takeoverFor("shared")?.purchasedAt, purchasedAt);
    assert.equal(
      await service.getViewerStatus({ wishId: "shared", actorId: "bob" }),
      "purchased",
    );

    await assert.rejects(
      service.releaseWish({ wishId: "shared", actorId: "alice", now }),
      serviceError("invalid_takeover_transition"),
    );
    assert.equal(repository.takeoverCount("shared"), 1);

    const reservedAgain = await service.markReserved({
      wishId: "shared",
      actorId: "alice",
      now: new Date(now.getTime() + 2),
    });
    assert.equal(reservedAgain.viewerStatus, "reserved_by_you");
    assert.equal(repository.takeoverFor("shared")?.purchasedAt, null);

    const released = await service.releaseWish({
      wishId: "shared",
      actorId: "alice",
      now: new Date(now.getTime() + 3),
    });
    assert.equal(released.viewerStatus, "available");
    assert.equal(repository.takeoverCount("shared"), 0);
  });

  it("requires current visibility for later manual transitions", async () => {
    const { repository, service, now } = fixture();
    await service.reserveWish({ wishId: "shared", actorId: "alice", now });
    repository.removeMember("group-a", "alice");
    repository.removeMember("group-b", "alice");

    await assert.rejects(
      service.markPurchased({ wishId: "shared", actorId: "alice", now }),
      serviceError("takeover_access_denied"),
    );
    // Ticket #14 owns automatic release; ticket #12 preserves the row.
    assert.equal(repository.takeoverCount("shared"), 1);
  });
});
