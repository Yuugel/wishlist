import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  groupInvites,
  groupMemberships,
  groups,
  recoveryCodes,
  sessions,
  users,
  webauthnCeremonies,
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
