import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ActivityRecord,
  ActivityRepository,
  WishChangeActivitySource,
} from "./activity-repository";
import type { WishChangeSet } from "../wishes/wish-repository";
import { serializeActivity } from "./activity-view";
import {
  createActivityService,
  createWishChangedActivity,
  ActivityServiceError,
} from "./activity-service";

class MemoryActivityRepository implements ActivityRepository {
  private readonly records: ActivityRecord[] = [];

  add(record: ActivityRecord): void {
    this.records.push(record);
  }

  async listForRecipient(recipientId: string): Promise<ActivityRecord[]> {
    return this.records
      .filter((record) => record.recipientId === recipientId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((record) => ({
        ...record,
        changedFields: [...record.changedFields],
        addedGroupIds: [...record.addedGroupIds],
        removedGroupIds: [...record.removedGroupIds],
      }));
  }
}

const now = new Date("2026-09-17T12:00:00.000Z");

function record(
  id: string,
  recipientId: string,
  createdAt: Date,
): ActivityRecord {
  return {
    id,
    recipientId,
    eventType: "wish_changed",
    wishId: "wish-1",
    wishTitle: "Kopfhörer",
    changedFields: ["title"],
    addedGroupIds: [],
    removedGroupIds: [],
    createdAt,
  };
}

describe("activity service", () => {
  it("lists only the authenticated recipient's activities, newest first", async () => {
    const repository = new MemoryActivityRepository();
    repository.add(record("old", "alice", new Date(now.getTime() - 1_000)));
    repository.add(record("new", "alice", now));
    repository.add(record("other", "bob", new Date(now.getTime() + 1_000)));
    const service = createActivityService(repository);

    const activities = await service.listActivities({ userId: "alice" });

    assert.deepEqual(
      activities.map((activity) => activity.id),
      ["new", "old"],
    );
    assert.ok(activities.every((activity) => activity.recipientId === "alice"));
    assert.deepEqual(
      await service.listActivities({ userId: "bob" }).then((items) =>
        items.map((item) => item.id),
      ),
      ["other"],
    );
  });

  it("serializes activity without returning the recipient identity", () => {
    const serialized = serializeActivity(record("one", "alice", now));

    assert.equal("recipientId" in serialized, false);
    assert.equal(serialized.createdAt, now.toISOString());
    assert.equal(serialized.wishId, "wish-1");
  });

  it("requires a recipient from the server-side actor boundary", async () => {
    const service = createActivityService(new MemoryActivityRepository());

    await assert.rejects(
      service.listActivities({ userId: "  " }),
      (error: unknown) =>
        error instanceof ActivityServiceError &&
        error.code === "activity_access_denied",
    );
  });

  it("creates one aggregate event for fields and group additions/removals", () => {
    const source: WishChangeActivitySource = {
      activeTakeover: { takerId: "taker", status: "reserved" },
      wishId: "wish-1",
      wishTitle: "Kopfhörer",
      changes: {
        changedFields: ["title", "description", "link", "priceText"],
        addedGroupIds: ["group-new"],
        removedGroupIds: ["group-old"],
        isNoop: false,
      },
      createdAt: now,
    };

    const activity = createWishChangedActivity(source);

    assert.deepEqual(activity, {
      recipientId: "taker",
      wishId: "wish-1",
      wishTitle: "Kopfhörer",
      changedFields: ["title", "description", "link", "priceText"],
      addedGroupIds: ["group-new"],
      removedGroupIds: ["group-old"],
      createdAt: now,
    });
  });

  it("also targets the current taker for a purchased wish", () => {
    const activity = createWishChangedActivity({
      activeTakeover: { takerId: "buyer", status: "purchased" },
      wishId: "wish-1",
      wishTitle: "Kopfhörer",
      changes: {
        changedFields: ["priceText"],
        addedGroupIds: [],
        removedGroupIds: [],
        isNoop: false,
      },
      createdAt: now,
    });

    assert.equal(activity?.recipientId, "buyer");
    assert.deepEqual(activity?.changedFields, ["priceText"]);
  });

  it("does not create an event without an active takeover or for a no-op", () => {
    const changes: WishChangeSet = {
      changedFields: ["title"],
      addedGroupIds: [],
      removedGroupIds: [],
      isNoop: false,
    };
    assert.equal(
      createWishChangedActivity({
        activeTakeover: null,
        wishId: "wish-1",
        wishTitle: "Kopfhörer",
        changes,
        createdAt: now,
      }),
      null,
    );

    assert.equal(
      createWishChangedActivity({
        activeTakeover: { takerId: "buyer", status: "reserved" },
        wishId: "wish-1",
        wishTitle: "Kopfhörer",
        changes: {
          changedFields: [],
          addedGroupIds: [],
          removedGroupIds: [],
          isNoop: true,
        },
        createdAt: now,
      }),
      null,
    );
  });
});
