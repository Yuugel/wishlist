import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  activities,
  activityEventType,
  groupInvites,
  groupMemberships,
  groups,
  recoveryCodes,
  sessions,
  users,
  webauthnCeremonies,
  wishGroups,
  wishes,
  wishTakeovers,
  webauthnCredentials,
} from "./schema";

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).indexes.flatMap((entry) =>
    entry.config.name ? [entry.config.name] : [],
  );
}

function checkNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).checks.map((entry) => entry.name);
}

describe("auth schema security constraints", () => {
  it("keeps email nullable and has no password column", () => {
    const columns = getTableConfig(users).columns;
    const names = columns.map((column) => column.name);
    const email = columns.find((column) => column.name === "email");

    assert.equal(email?.notNull, false);
    assert.equal(names.some((name) => name.includes("password")), false);
    assert.ok(indexNames(users).includes("users_webauthn_user_handle_unique"));
  });

  it("allows many credentials per user while credential IDs are global", () => {
    assert.ok(
      indexNames(webauthnCredentials).includes(
        "webauthn_credentials_credential_id_unique",
      ),
    );
    assert.ok(
      indexNames(webauthnCredentials).includes(
        "webauthn_credentials_user_id_index",
      ),
    );
  });

  it("constrains session and recovery storage to digests", () => {
    const sessionColumns = getTableConfig(sessions).columns.map(
      (column) => column.name,
    );
    const recoveryColumns = getTableConfig(recoveryCodes).columns.map(
      (column) => column.name,
    );

    assert.ok(sessionColumns.includes("token_digest"));
    assert.equal(sessionColumns.includes("token"), false);
    assert.ok(recoveryColumns.includes("digest"));
    assert.equal(recoveryColumns.includes("secret"), false);
    assert.equal(recoveryColumns.includes("display_code"), false);
    assert.ok(
      indexNames(recoveryCodes).includes(
        "recovery_codes_one_active_per_user_unique",
      ),
    );
    assert.ok(checkNames(recoveryCodes).includes("recovery_codes_state_check"));
  });

  it("models flat group membership and hashed invite storage", () => {
    const groupColumns = getTableConfig(groups).columns.map(
      (column) => column.name,
    );
    const membershipColumns = getTableConfig(groupMemberships).columns.map(
      (column) => column.name,
    );
    const inviteColumns = getTableConfig(groupInvites).columns.map(
      (column) => column.name,
    );
    const membershipPrimaryKey = getTableConfig(groupMemberships).primaryKeys;

    assert.deepEqual(groupColumns, [
      "id",
      "name",
      "created_at",
      "updated_at",
    ]);
    assert.deepEqual(membershipColumns, ["group_id", "user_id", "created_at"]);
    assert.deepEqual(inviteColumns, [
      "id",
      "group_id",
      "selector",
      "digest",
      "expires_at",
      "created_at",
      "updated_at",
    ]);
    assert.equal(inviteColumns.includes("token"), false);
    assert.equal(inviteColumns.includes("secret"), false);
    assert.deepEqual(
      membershipPrimaryKey[0]?.columns.map((column) => column.name),
      ["group_id", "user_id"],
    );
    assert.ok(
      indexNames(groupMemberships).includes(
        "group_memberships_user_id_index",
      ),
    );
    assert.ok(
      indexNames(groupInvites).includes("group_invites_selector_unique"),
    );
    assert.ok(
      indexNames(groupInvites).includes("group_invites_expires_at_index"),
    );
    assert.ok(checkNames(groups).includes("groups_name_length_check"));
    assert.ok(
      checkNames(groupInvites).includes("group_invites_digest_length_check"),
    );
    assert.ok(checkNames(groupInvites).includes("group_invites_expiry_check"));
    assert.equal(
      [...groupColumns, ...membershipColumns, ...inviteColumns].some(
        (name) => name === "owner_id" || name === "role",
      ),
      false,
    );
  });

  it("models one wish with reusable many-to-many group assignments", () => {
    const wishColumns = getTableConfig(wishes).columns.map(
      (column) => column.name,
    );
    const wishGroupColumns = getTableConfig(wishGroups).columns.map(
      (column) => column.name,
    );
    const wishGroupPrimaryKey = getTableConfig(wishGroups).primaryKeys;

    assert.deepEqual(wishColumns, [
      "id",
      "owner_id",
      "title",
      "description",
      "link",
      "price_text",
      "created_at",
      "updated_at",
    ]);
    assert.deepEqual(wishGroupColumns, [
      "wish_id",
      "group_id",
      "created_at",
    ]);
    assert.deepEqual(
      wishGroupPrimaryKey[0]?.columns.map((column) => column.name),
      ["wish_id", "group_id"],
    );
    assert.ok(indexNames(wishes).includes("wishes_owner_id_index"));
    assert.ok(indexNames(wishGroups).includes("wish_groups_group_id_index"));
    assert.ok(checkNames(wishes).includes("wishes_title_length_check"));
    assert.ok(checkNames(wishes).includes("wishes_description_length_check"));
    assert.ok(checkNames(wishes).includes("wishes_link_length_check"));
    assert.ok(checkNames(wishes).includes("wishes_price_text_length_check"));
  });

  it("enforces one global active takeover per wish with safe status timestamps", () => {
    const config = getTableConfig(wishTakeovers);
    const columns = config.columns.map((column) => column.name);
    const wishId = config.columns.find((column) => column.name === "wish_id");
    const status = config.columns.find((column) => column.name === "status");

    assert.deepEqual(columns, [
      "wish_id",
      "taker_id",
      "status",
      "purchased_at",
      "created_at",
      "updated_at",
    ]);
    assert.equal(wishId?.primary, true);
    assert.deepEqual(status?.enumValues, ["reserved", "purchased"]);
    assert.ok(indexNames(wishTakeovers).includes("wish_takeovers_taker_id_index"));
    assert.ok(
      checkNames(wishTakeovers).includes(
        "wish_takeovers_status_timestamp_check",
      ),
    );
    assert.ok(
      checkNames(wishTakeovers).includes("wish_takeovers_updated_at_check"),
    );
    assert.equal(config.foreignKeys.length, 2);
  });

  it("models recipient-scoped wish-change activity with deletion-safe wish links", () => {
    const config = getTableConfig(activities);
    const columns = config.columns.map((column) => column.name);
    const eventType = config.columns.find(
      (column) => column.name === "event_type",
    );
    const wishId = config.columns.find((column) => column.name === "wish_id");

    assert.deepEqual(columns, [
      "id",
      "recipient_id",
      "event_type",
      "wish_id",
      "wish_title",
      "takeover_status",
      "group_name",
      "changed_fields",
      "added_group_ids",
      "removed_group_ids",
      "created_at",
    ]);
    assert.deepEqual(eventType?.enumValues, [
      "wish_changed",
      "takeover_released_visibility_lost",
      "wish_deleted",
      "group_dissolved",
    ]);
    assert.deepEqual(activityEventType.enumValues, eventType?.enumValues);
    assert.equal(wishId?.notNull, false);
    assert.equal(config.foreignKeys.length, 2);
    assert.ok(
      indexNames(activities).includes(
        "activities_recipient_created_at_index",
      ),
    );
    assert.ok(indexNames(activities).includes("activities_wish_id_index"));
    assert.ok(
      checkNames(activities).includes("activities_event_data_check"),
    );
  });

  it("models ceremony expiry, consumption, bounded attempts, and binding", () => {
    const columns = getTableConfig(webauthnCeremonies).columns.map(
      (column) => column.name,
    );
    const checks = checkNames(webauthnCeremonies);

    assert.ok(columns.includes("expires_at"));
    assert.ok(columns.includes("consumed_at"));
    assert.ok(columns.includes("attempt_count"));
    assert.ok(columns.includes("challenge_digest"));
    assert.equal(columns.includes("challenge"), false);
    assert.ok(columns.includes("pending_email"));
    assert.ok(checks.includes("webauthn_ceremonies_expiry_check"));
    assert.ok(checks.includes("webauthn_ceremonies_attempts_check"));
    assert.ok(checks.includes("webauthn_ceremonies_recovery_binding_check"));
  });
});
