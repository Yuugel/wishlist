import "server-only";

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import type {
  ReleaseTakeoverResult,
  ReserveTakeoverResult,
  TakeoverRecord,
  TakeoverRepository,
  TransitionTakeoverResult,
} from "./takeover-repository";

type MutationRow = {
  kind: "reserved" | "already-taken" | "transitioned" | "released" | "invalid-transition" | "access-denied";
  wish_id: string | null;
  taker_id: string | null;
  status: "reserved" | "purchased" | null;
  purchased_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
};

function takeoverFromRow(row: MutationRow): TakeoverRecord {
  if (
    !row.wish_id ||
    !row.taker_id ||
    !row.status ||
    !row.created_at ||
    !row.updated_at
  ) {
    throw new Error("Takeover mutation returned an incomplete record");
  }

  return {
    wishId: row.wish_id,
    takerId: row.taker_id,
    status: row.status,
    purchasedAt: row.purchased_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mutationRow(result: { rows: MutationRow[] }): MutationRow {
  const row = result.rows[0];
  if (!row) throw new Error("Takeover mutation returned no result");
  return row;
}

type SqlExecutor = Pick<typeof db, "execute">;

async function lockVisibilityGroups(
  executor: SqlExecutor,
  input: { wishId: string; actorId: string },
): Promise<void> {
  // Group leave/dissolution and wish assignment changes use group-row locks.
  // Acquiring those locks before the shared wish-row lock gives all lifecycle
  // mutations one ordering and prevents a reserve from committing against a
  // membership snapshot that has just become invalid.
  await executor.execute(sql`
    select visible_group.id
    from groups visible_group
    inner join wish_groups assignment
      on assignment.group_id = visible_group.id
    inner join wishes wish on wish.id = assignment.wish_id
    inner join group_memberships viewer_membership
      on viewer_membership.group_id = assignment.group_id
     and viewer_membership.user_id = ${input.actorId}
    inner join group_memberships owner_membership
      on owner_membership.group_id = assignment.group_id
     and owner_membership.user_id = wish.owner_id
    where wish.id = ${input.wishId}
      and wish.owner_id <> ${input.actorId}
    order by visible_group.id
    for update of visible_group
  `);
}

/**
 * Authorization is deliberately part of every mutation statement. A wish is
 * visible only while both owner and actor are current members of at least one
 * group to which that wish is assigned.
 */
export const drizzleTakeoverRepository: TakeoverRepository = {
  async reserve(input): Promise<ReserveTakeoverResult> {
    return db.transaction(async (tx) => {
      await lockVisibilityGroups(tx, input);
      const result = await tx.execute<MutationRow>(sql`
      with authorized_wish as (
        select w.id
        from wishes w
        where w.id = ${input.wishId}
          and w.owner_id <> ${input.actorId}
          and exists (
            select 1
            from wish_groups wg
            inner join group_memberships viewer_membership
              on viewer_membership.group_id = wg.group_id
             and viewer_membership.user_id = ${input.actorId}
            inner join group_memberships owner_membership
              on owner_membership.group_id = wg.group_id
             and owner_membership.user_id = w.owner_id
            where wg.wish_id = w.id
          )
        for update of w
      ), inserted as (
        insert into wish_takeovers (
          wish_id,
          taker_id,
          status,
          purchased_at,
          created_at,
          updated_at
        )
        select id, ${input.actorId}, 'reserved', null, ${input.now}, ${input.now}
        from authorized_wish
        on conflict (wish_id) do nothing
        returning wish_id, taker_id, status, purchased_at, created_at, updated_at
      )
      select
        case
          when exists (select 1 from inserted) then 'reserved'
          when exists (select 1 from authorized_wish) then 'already-taken'
          else 'access-denied'
        end as kind,
        (select wish_id from inserted) as wish_id,
        (select taker_id from inserted) as taker_id,
        (select status from inserted) as status,
        (select purchased_at from inserted) as purchased_at,
        (select created_at from inserted) as created_at,
        (select updated_at from inserted) as updated_at
    `);
    const row = mutationRow(result);
    if (row.kind === "reserved") {
      return { kind: "reserved", takeover: takeoverFromRow(row) };
    }
      if (row.kind === "already-taken") return { kind: "already-taken" };
      return { kind: "access-denied" };
    });
  },

  async transition(input): Promise<TransitionTakeoverResult> {
    return db.transaction(async (tx) => {
      await lockVisibilityGroups(tx, input);
      const result = await tx.execute<MutationRow>(sql`
      with authorized_wish as (
        select w.id
        from wishes w
        where w.id = ${input.wishId}
          and w.owner_id <> ${input.actorId}
          and exists (
            select 1
            from wish_groups wg
            inner join group_memberships viewer_membership
              on viewer_membership.group_id = wg.group_id
             and viewer_membership.user_id = ${input.actorId}
            inner join group_memberships owner_membership
              on owner_membership.group_id = wg.group_id
             and owner_membership.user_id = w.owner_id
            where wg.wish_id = w.id
          )
        for update of w
      ), updated as (
        update wish_takeovers takeover
        set status = ${input.to}::wish_takeover_status,
            purchased_at = case
              when ${input.to}::wish_takeover_status = 'purchased'
                then ${input.now}
              else null
            end,
            updated_at = ${input.now}
        where takeover.wish_id in (select id from authorized_wish)
          and takeover.taker_id = ${input.actorId}
          and takeover.status = ${input.from}::wish_takeover_status
        returning wish_id, taker_id, status, purchased_at, created_at, updated_at
      )
      select
        case
          when exists (select 1 from updated) then 'transitioned'
          when not exists (select 1 from authorized_wish) then 'access-denied'
          when not exists (
            select 1
            from wish_takeovers takeover
            where takeover.wish_id = ${input.wishId}
              and takeover.taker_id = ${input.actorId}
          ) then 'access-denied'
          else 'invalid-transition'
        end as kind,
        (select wish_id from updated) as wish_id,
        (select taker_id from updated) as taker_id,
        (select status from updated) as status,
        (select purchased_at from updated) as purchased_at,
        (select created_at from updated) as created_at,
        (select updated_at from updated) as updated_at
    `);
    const row = mutationRow(result);
    if (row.kind === "transitioned") {
      return { kind: "transitioned", takeover: takeoverFromRow(row) };
    }
      if (row.kind === "invalid-transition") {
        return { kind: "invalid-transition" };
      }
      return { kind: "access-denied" };
    });
  },

  async release(input): Promise<ReleaseTakeoverResult> {
    return db.transaction(async (tx) => {
      await lockVisibilityGroups(tx, input);
      const result = await tx.execute<MutationRow>(sql`
      with authorized_wish as (
        select w.id
        from wishes w
        where w.id = ${input.wishId}
          and w.owner_id <> ${input.actorId}
          and exists (
            select 1
            from wish_groups wg
            inner join group_memberships viewer_membership
              on viewer_membership.group_id = wg.group_id
             and viewer_membership.user_id = ${input.actorId}
            inner join group_memberships owner_membership
              on owner_membership.group_id = wg.group_id
             and owner_membership.user_id = w.owner_id
            where wg.wish_id = w.id
          )
        for update of w
      ), deleted as (
        delete from wish_takeovers takeover
        where takeover.wish_id in (select id from authorized_wish)
          and takeover.taker_id = ${input.actorId}
          and takeover.status = 'reserved'
        returning wish_id, taker_id, status, purchased_at, created_at, updated_at
      )
      select
        case
          when exists (select 1 from deleted) then 'released'
          when not exists (select 1 from authorized_wish) then 'access-denied'
          when not exists (
            select 1
            from wish_takeovers takeover
            where takeover.wish_id = ${input.wishId}
              and takeover.taker_id = ${input.actorId}
          ) then 'access-denied'
          else 'invalid-transition'
        end as kind,
        (select wish_id from deleted) as wish_id,
        (select taker_id from deleted) as taker_id,
        (select status from deleted) as status,
        (select purchased_at from deleted) as purchased_at,
        (select created_at from deleted) as created_at,
        (select updated_at from deleted) as updated_at
    `);
    const row = mutationRow(result);
    if (row.kind === "released") {
      return { kind: "released", takeover: takeoverFromRow(row) };
    }
      if (row.kind === "invalid-transition") {
        return { kind: "invalid-transition" };
      }
      return { kind: "access-denied" };
    });
  },

  async getViewerStatus(input) {
    const result = await db.execute<{
      status: "reserved" | "purchased" | null;
      is_taken_by_viewer: boolean;
    }>(sql`
      select takeover.status,
             coalesce(takeover.taker_id = ${input.actorId}, false) as is_taken_by_viewer
      from wishes wish
      left join wish_takeovers takeover on takeover.wish_id = wish.id
      where wish.id = ${input.wishId}
        and wish.owner_id <> ${input.actorId}
        and exists (
          select 1
          from wish_groups wg
          inner join group_memberships viewer_membership
            on viewer_membership.group_id = wg.group_id
           and viewer_membership.user_id = ${input.actorId}
          inner join group_memberships owner_membership
            on owner_membership.group_id = wg.group_id
           and owner_membership.user_id = wish.owner_id
          where wg.wish_id = wish.id
        )
      limit 1
    `);
    const row = result.rows[0];
    if (!row) return { kind: "access-denied" };
    return {
      kind: "visible",
      status: row.status,
      isTakenByViewer: row.is_taken_by_viewer,
    };
  },
};
