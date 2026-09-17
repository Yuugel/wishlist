import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const userStatus = pgEnum("user_status", ["active", "disabled"]);
export const webauthnDeviceType = pgEnum("webauthn_device_type", [
  "single_device",
  "multi_device",
]);
export const webauthnCeremonyType = pgEnum("webauthn_ceremony_type", [
  "signup",
  "authentication",
  "add_credential",
  "recovery",
]);
export const recoveryCodeStatus = pgEnum("recovery_code_status", [
  "active",
  "claimed",
  "consumed",
  "revoked",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    webauthnUserHandle: bytea("webauthn_user_handle").notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    email: varchar("email", { length: 320 }),
    emailNormalized: varchar("email_normalized", { length: 320 }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    status: userStatus("status").default("active").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_webauthn_user_handle_unique").on(
      table.webauthnUserHandle,
    ),
    uniqueIndex("users_email_normalized_unique")
      .on(table.emailNormalized)
      .where(sql`${table.emailNormalized} is not null`),
    check(
      "users_webauthn_user_handle_length_check",
      sql`octet_length(${table.webauthnUserHandle}) = 32`,
    ),
    check(
      "users_email_pair_check",
      sql`(${table.email} is null and ${table.emailNormalized} is null) or (${table.email} is not null and ${table.emailNormalized} is not null)`,
    ),
  ],
);

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    ...timestamps,
  },
  (table) => [
    check(
      "groups_name_length_check",
      sql`char_length(btrim(${table.name})) between 1 and 200`,
    ),
  ],
);

export const groupMemberships = pgTable(
  "group_memberships",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "group_memberships_group_id_user_id_pk",
      columns: [table.groupId, table.userId],
    }),
    index("group_memberships_user_id_index").on(table.userId),
  ],
);

export const groupInvites = pgTable(
  "group_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    selector: varchar("selector", { length: 22 }).notNull(),
    digest: bytea("digest").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("group_invites_selector_unique").on(table.selector),
    index("group_invites_group_id_index").on(table.groupId),
    index("group_invites_expires_at_index").on(table.expiresAt),
    check(
      "group_invites_digest_length_check",
      sql`octet_length(${table.digest}) = 32`,
    ),
    check(
      "group_invites_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: bytea("credential_id").notNull(),
    publicKey: bytea("public_key").notNull(),
    counter: bigint("counter", { mode: "bigint" }).default(sql`0`).notNull(),
    transports: text("transports").array().default(sql`ARRAY[]::text[]`).notNull(),
    deviceType: webauthnDeviceType("device_type").notNull(),
    backedUp: boolean("backed_up").default(false).notNull(),
    aaguid: uuid("aaguid"),
    label: varchar("label", { length: 100 }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("webauthn_credentials_credential_id_unique").on(
      table.credentialId,
    ),
    index("webauthn_credentials_user_id_index").on(table.userId),
    check(
      "webauthn_credentials_credential_id_length_check",
      sql`octet_length(${table.credentialId}) between 1 and 1023`,
    ),
    check(
      "webauthn_credentials_public_key_length_check",
      sql`octet_length(${table.publicKey}) > 0`,
    ),
    check(
      "webauthn_credentials_counter_check",
      sql`${table.counter} >= 0`,
    ),
  ],
);

export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    selector: varchar("selector", { length: 22 }).notNull(),
    digest: bytea("digest").notNull(),
    pepperKeyVersion: integer("pepper_key_version").notNull(),
    status: recoveryCodeStatus("status").default("active").notNull(),
    claimId: uuid("claim_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("recovery_codes_selector_unique").on(table.selector),
    uniqueIndex("recovery_codes_claim_id_unique")
      .on(table.claimId)
      .where(sql`${table.claimId} is not null`),
    uniqueIndex("recovery_codes_one_active_per_user_unique")
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    index("recovery_codes_user_id_index").on(table.userId),
    check(
      "recovery_codes_digest_length_check",
      sql`octet_length(${table.digest}) = 32`,
    ),
    check(
      "recovery_codes_pepper_key_version_check",
      sql`${table.pepperKeyVersion} > 0`,
    ),
    check(
      "recovery_codes_state_check",
      sql`(
        (${table.status} = 'active' and ${table.claimId} is null and ${table.claimedAt} is null and ${table.consumedAt} is null and ${table.revokedAt} is null)
        or (${table.status} = 'claimed' and ${table.claimId} is not null and ${table.claimedAt} is not null and ${table.consumedAt} is null and ${table.revokedAt} is null)
        or (${table.status} = 'consumed' and ${table.claimId} is not null and ${table.claimedAt} is not null and ${table.consumedAt} is not null and ${table.revokedAt} is null)
        or (${table.status} = 'revoked' and ${table.consumedAt} is null and ${table.revokedAt} is not null)
      )`,
    ),
  ],
);

export const webauthnCeremonies = pgTable(
  "webauthn_ceremonies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: webauthnCeremonyType("type").notNull(),
    challengeDigest: bytea("challenge_digest").notNull(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    recoveryCodeId: uuid("recovery_code_id").references(
      () => recoveryCodes.id,
      { onDelete: "cascade" },
    ),
    pendingUserHandle: bytea("pending_user_handle"),
    pendingDisplayName: varchar("pending_display_name", { length: 200 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("webauthn_ceremonies_challenge_digest_unique").on(
      table.challengeDigest,
    ),
    index("webauthn_ceremonies_user_id_index").on(table.userId),
    index("webauthn_ceremonies_recovery_code_id_index").on(
      table.recoveryCodeId,
    ),
    index("webauthn_ceremonies_expires_at_index").on(table.expiresAt),
    check(
      "webauthn_ceremonies_challenge_digest_length_check",
      sql`octet_length(${table.challengeDigest}) = 32`,
    ),
    check(
      "webauthn_ceremonies_pending_user_handle_length_check",
      sql`${table.pendingUserHandle} is null or octet_length(${table.pendingUserHandle}) = 32`,
    ),
    check(
      "webauthn_ceremonies_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "webauthn_ceremonies_consumed_at_check",
      sql`${table.consumedAt} is null or ${table.consumedAt} >= ${table.createdAt}`,
    ),
    check(
      "webauthn_ceremonies_attempts_check",
      sql`${table.attemptCount} >= 0 and ${table.maxAttempts} > 0 and ${table.attemptCount} <= ${table.maxAttempts}`,
    ),
    check(
      "webauthn_ceremonies_recovery_binding_check",
      sql`${table.type} <> 'recovery' or ${table.recoveryCodeId} is not null`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenDigest: bytea("token_digest").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", {
      withTimezone: true,
    }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sessions_token_digest_unique").on(table.tokenDigest),
    index("sessions_user_id_index").on(table.userId),
    index("sessions_idle_expires_at_index").on(table.idleExpiresAt),
    index("sessions_absolute_expires_at_index").on(table.absoluteExpiresAt),
    check(
      "sessions_token_digest_length_check",
      sql`octet_length(${table.tokenDigest}) = 32`,
    ),
    check(
      "sessions_expiry_check",
      sql`${table.idleExpiresAt} > ${table.createdAt} and ${table.absoluteExpiresAt} >= ${table.idleExpiresAt}`,
    ),
    check(
      "sessions_revoked_at_check",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);
