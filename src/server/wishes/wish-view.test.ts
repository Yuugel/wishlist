import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  serializeGroupWishView,
  serializeOwnerWishView,
  toGroupOwnerWishView,
  toGroupViewerWishView,
  toOwnerWishView,
} from "./wish-view";
import type { WishRecord } from "./wish-repository";

describe("wish view boundaries", () => {
  it("projects owner and viewer DTOs without repository or future secret fields", () => {
    const now = new Date("2026-09-17T00:00:00.000Z");
    const record: WishRecord = {
      id: "wish-1",
      ownerId: "alice",
      title: "Buch",
      description: "Notiz",
      link: "https://example.test/book",
      priceText: "20 €",
      groups: [
        {
          id: "group-a",
          name: "A",
          createdAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    const secretBearingRecord = {
      ...record,
      takeoverStatus: "purchased" as const,
      takeoverTakerId: "bob",
      autoReleased: true,
      activityRecipientId: "bob",
      affectedTakeoverCount: 1,
    };
    const owner = toOwnerWishView(secretBearingRecord);
    const groupOwner = toGroupOwnerWishView(secretBearingRecord);
    const viewer = toGroupViewerWishView(secretBearingRecord, "purchased");
    const serializedOwner = serializeOwnerWishView(owner);
    const serializedGroupOwner = serializeGroupWishView(groupOwner);
    const serializedViewer = serializeGroupWishView(viewer);

    assert.equal(owner.audience, "owner");
    assert.equal(groupOwner.audience, "owner");
    assert.equal(viewer.audience, "viewer");
    assert.equal(owner.ownerId, "alice");
    assert.equal("ownerId" in viewer, false);
    assert.equal("reservation" in owner, false);
    assert.equal("reservation" in viewer, false);
    assert.equal("takeoverStatus" in owner, false);
    assert.equal("takeoverTakerId" in owner, false);
    assert.equal("takeoverStatus" in groupOwner, false);
    assert.deepEqual(serializedOwner.groups, [
      { id: "group-a", name: "A", createdAt: now.toISOString() },
    ]);
    assert.equal(serializedOwner.ownerId, "alice");
    assert.equal("groups" in serializedViewer, false);
    assert.equal("reservation" in serializedViewer, false);
    assert.equal("takeoverTakerId" in serializedViewer, false);
    assert.equal("takeoverStatus" in serializedViewer, true);
    if ("takeoverStatus" in serializedViewer) {
      assert.equal(serializedViewer.takeoverStatus, "purchased");
    }
    assert.equal("takeoverStatus" in serializedOwner, false);
    assert.equal("takeoverStatus" in serializedGroupOwner, false);
    assert.equal("autoReleased" in serializedOwner, false);
    assert.equal("activityRecipientId" in serializedOwner, false);
    assert.equal("affectedTakeoverCount" in serializedOwner, false);
  });
});
