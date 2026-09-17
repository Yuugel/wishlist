import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasCommonWishVisibility,
  takeoversAffectedByGroupExit,
  type ActiveTakeoverVisibility,
  type MembershipState,
} from "./lifecycle-policy";

function memberships(entries: Record<string, string[]>): MembershipState {
  return new Map(
    Object.entries(entries).map(([groupId, userIds]) => [
      groupId,
      new Set(userIds),
    ]),
  );
}

function takeover(
  overrides: Partial<ActiveTakeoverVisibility> = {},
): ActiveTakeoverVisibility {
  return {
    wishId: "wish-1",
    ownerId: "owner",
    takerId: "taker",
    status: "reserved",
    wishGroupIds: ["group-a"],
    ...overrides,
  };
}

const sharedMemberships = memberships({
  "group-a": ["owner", "taker", "other"],
  "group-b": ["owner", "taker"],
});

describe("takeover lifecycle visibility policy", () => {
  it("requires one wish-assigned group containing both owner and taker", () => {
    assert.equal(hasCommonWishVisibility(takeover(), sharedMemberships), true);
    assert.equal(
      hasCommonWishVisibility(
        takeover(),
        memberships({ "group-a": ["owner"], "group-b": ["owner", "taker"] }),
      ),
      false,
      "a shared group does not count unless this wish is assigned to it",
    );
    assert.equal(
      hasCommonWishVisibility(
        takeover({ wishGroupIds: [] }),
        sharedMemberships,
      ),
      false,
      "private wishes cannot retain a takeover",
    );
  });

  it("keeps reserved and purchased takeovers through another common wish group", () => {
    for (const status of ["reserved", "purchased"] as const) {
      const active = takeover({ status, wishGroupIds: ["group-a", "group-b"] });
      assert.equal(
        hasCommonWishVisibility(active, sharedMemberships, {
          excludedGroupIds: new Set(["group-a"]),
        }),
        true,
      );
    }
  });

  it("marks the last common wish group and a transition to private as invalid", () => {
    assert.equal(
      hasCommonWishVisibility(takeover(), sharedMemberships, {
        excludedGroupIds: new Set(["group-a"]),
      }),
      false,
    );
    assert.equal(
      hasCommonWishVisibility(
        takeover({ status: "purchased", wishGroupIds: [] }),
        sharedMemberships,
      ),
      false,
      "system lifecycle release applies directly to purchased takeovers too",
    );
  });

  it("requires confirmation for taker and owner exits that lose the last visibility", () => {
    const active = takeover();
    assert.deepEqual(
      takeoversAffectedByGroupExit([active], sharedMemberships, {
        groupId: "group-a",
        userId: "taker",
        dissolves: false,
      }).map((item) => item.wishId),
      ["wish-1"],
    );
    assert.deepEqual(
      takeoversAffectedByGroupExit([active], sharedMemberships, {
        groupId: "group-a",
        userId: "owner",
        dissolves: false,
      }).map((item) => item.wishId),
      ["wish-1"],
    );
  });

  it("does not warn for unrelated exits or takeovers retained by another group", () => {
    const retained = takeover({ wishGroupIds: ["group-a", "group-b"] });
    assert.deepEqual(
      takeoversAffectedByGroupExit([retained], sharedMemberships, {
        groupId: "group-a",
        userId: "taker",
        dissolves: false,
      }),
      [],
    );
    assert.deepEqual(
      takeoversAffectedByGroupExit([takeover()], sharedMemberships, {
        groupId: "group-a",
        userId: "other",
        dissolves: false,
      }),
      [],
    );
  });

  it("evaluates every group wish during dissolution but retains alternate visibility", () => {
    const released = takeover({ wishId: "released" });
    const retained = takeover({
      wishId: "retained",
      status: "purchased",
      wishGroupIds: ["group-a", "group-b"],
    });
    assert.deepEqual(
      takeoversAffectedByGroupExit([released, retained], sharedMemberships, {
        groupId: "group-a",
        userId: "other",
        dissolves: true,
      }).map((item) => item.wishId),
      ["released"],
    );
  });

  it("recomputes from changed current state instead of trusting a preview", () => {
    const active = takeover({ wishGroupIds: ["group-a", "group-b"] });
    const previewMemberships = memberships({
      "group-a": ["owner", "taker"],
      "group-b": ["owner", "taker"],
    });
    assert.equal(
      takeoversAffectedByGroupExit([active], previewMemberships, {
        groupId: "group-a",
        userId: "taker",
        dissolves: false,
      }).length,
      0,
    );

    const confirmationMemberships = memberships({
      "group-a": ["owner", "taker"],
      "group-b": ["owner"],
    });
    assert.equal(
      takeoversAffectedByGroupExit([active], confirmationMemberships, {
        groupId: "group-a",
        userId: "taker",
        dissolves: false,
      }).length,
      1,
    );
  });
});
