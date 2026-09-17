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

    const owner = toOwnerWishView(record);
    const groupOwner = toGroupOwnerWishView(record);
    const viewer = toGroupViewerWishView(record);
    const serializedOwner = serializeOwnerWishView(owner);
    const serializedViewer = serializeGroupWishView(viewer);

    assert.equal(owner.audience, "owner");
    assert.equal(groupOwner.audience, "owner");
    assert.equal(viewer.audience, "viewer");
    assert.equal(owner.ownerId, "alice");
    assert.equal("ownerId" in viewer, false);
    assert.equal("reservation" in owner, false);
    assert.equal("reservation" in viewer, false);
    assert.deepEqual(serializedOwner.groups, [
      { id: "group-a", name: "A", createdAt: now.toISOString() },
    ]);
    assert.equal(serializedOwner.ownerId, "alice");
    assert.equal("groups" in serializedViewer, false);
    assert.equal("reservation" in serializedViewer, false);
  });
});
