import "server-only";

import type {
  WishChangeSet,
  WishField,
  WishRecord,
  WishRepository,
  WishValues,
} from "./wish-repository";

export const WISH_TITLE_MAX_LENGTH = 200;
export const WISH_DESCRIPTION_MAX_LENGTH = 5_000;
export const WISH_LINK_MAX_LENGTH = 2_048;
export const WISH_PRICE_TEXT_MAX_LENGTH = 200;

export type WishServiceErrorCode =
  | "invalid_title"
  | "invalid_wish_field"
  | "invalid_group_ids"
  | "wish_access_denied";

export class WishServiceError extends Error {
  constructor(
    public readonly code: WishServiceErrorCode,
    message: string,
    public readonly invalidGroupIds: string[] = [],
  ) {
    super(message);
    this.name = "WishServiceError";
  }
}

type OptionalWishText = string | null | undefined;
type WishGroupIds = readonly string[] | null | undefined;

export type CreateWishInput = {
  ownerId: string;
  title: string;
  description?: OptionalWishText;
  link?: OptionalWishText;
  priceText?: OptionalWishText;
  groupIds?: WishGroupIds;
  now?: Date;
};

export type UpdateWishInput = {
  wishId: string;
  ownerId: string;
  title?: string | null;
  description?: OptionalWishText;
  link?: OptionalWishText;
  priceText?: OptionalWishText;
  groupIds?: WishGroupIds;
  now?: Date;
};

function requireActor(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WishServiceError(
      "wish_access_denied",
      "Ein authentifizierter Nutzer ist erforderlich.",
    );
  }
  return value.trim();
}

function requireIdentifier(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WishServiceError(
      "wish_access_denied",
      "Der Wunsch wurde nicht gefunden.",
    );
  }
  return value.trim();
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== "string") {
    throw new WishServiceError(
      "invalid_title",
      "Ein Wunschtitel ist erforderlich.",
    );
  }

  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > WISH_TITLE_MAX_LENGTH) {
    throw new WishServiceError(
      "invalid_title",
      "Der Wunschtitel muss zwischen 1 und 200 Zeichen enthalten.",
    );
  }
  return normalized;
}

function normalizeOptionalText(
  value: unknown,
  field: WishField,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new WishServiceError(
      "invalid_wish_field",
      `Das Feld ${field} muss Text enthalten.`,
    );
  }

  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (Array.from(normalized).length > maxLength) {
    throw new WishServiceError(
      "invalid_wish_field",
      `Das Feld ${field} ist zu lang.`,
    );
  }
  return normalized;
}

function normalizeGroupIds(
  value: WishGroupIds,
  optional: boolean,
): string[] | undefined {
  if (value === undefined) return optional ? undefined : [];
  if (!Array.isArray(value)) {
    throw new WishServiceError(
      "invalid_group_ids",
      "Die Gruppenzuordnung muss eine Liste sein.",
    );
  }

  const normalized = value.map((groupId) => {
    if (typeof groupId !== "string" || groupId.trim().length === 0) {
      throw new WishServiceError(
        "invalid_group_ids",
        "Die Gruppenzuordnung enthält eine ungültige Gruppen-ID.",
      );
    }
    return groupId.trim();
  });

  return [...new Set(normalized)].sort();
}

function normalizeCreateValues(input: CreateWishInput): WishValues {
  return {
    title: normalizeTitle(input.title),
    description: normalizeOptionalText(
      input.description,
      "description",
      WISH_DESCRIPTION_MAX_LENGTH,
    ),
    link: normalizeOptionalText(input.link, "link", WISH_LINK_MAX_LENGTH),
    priceText: normalizeOptionalText(
      input.priceText,
      "priceText",
      WISH_PRICE_TEXT_MAX_LENGTH,
    ),
  };
}

function normalizeUpdateValues(input: UpdateWishInput): Partial<WishValues> {
  const values: Partial<WishValues> = {};

  if (input.title !== undefined) values.title = normalizeTitle(input.title);
  if (input.description !== undefined) {
    values.description = normalizeOptionalText(
      input.description,
      "description",
      WISH_DESCRIPTION_MAX_LENGTH,
    );
  }
  if (input.link !== undefined) {
    values.link = normalizeOptionalText(input.link, "link", WISH_LINK_MAX_LENGTH);
  }
  if (input.priceText !== undefined) {
    values.priceText = normalizeOptionalText(
      input.priceText,
      "priceText",
      WISH_PRICE_TEXT_MAX_LENGTH,
    );
  }

  return values;
}

function invalidGroups(invalidGroupIds: string[]): WishServiceError {
  return new WishServiceError(
    "invalid_group_ids",
    "Der Wunsch darf nur Gruppen zugeordnet werden, in denen du Mitglied bist.",
    invalidGroupIds,
  );
}

export function createWishService(repository: WishRepository) {
  return {
    async createWish(input: CreateWishInput): Promise<WishRecord> {
      const ownerId = requireActor(input.ownerId);
      const groupIds = normalizeGroupIds(input.groupIds, false) ?? [];
      const result = await repository.createWish({
        ownerId,
        values: normalizeCreateValues(input),
        groupIds,
        now: input.now ?? new Date(),
      });

      if (result.kind === "invalid-groups") {
        throw invalidGroups(result.invalidGroupIds);
      }
      return result.wish;
    },

    async listWishes(input: { ownerId: string }): Promise<WishRecord[]> {
      return repository.listWishesForOwner(requireActor(input.ownerId));
    },

    async updateWish(input: UpdateWishInput): Promise<{
      wish: WishRecord;
      changes: WishChangeSet;
    }> {
      const ownerId = requireActor(input.ownerId);
      const wishId = requireIdentifier(input.wishId);
      const groupIds = normalizeGroupIds(input.groupIds, true);
      const result = await repository.updateWish({
        wishId,
        ownerId,
        values: normalizeUpdateValues(input),
        ...(groupIds === undefined ? {} : { groupIds }),
        now: input.now ?? new Date(),
      });

      if (result.kind === "not-found") {
        throw new WishServiceError(
          "wish_access_denied",
          "Der Wunsch wurde nicht gefunden oder gehört nicht dir.",
        );
      }
      if (result.kind === "invalid-groups") {
        throw invalidGroups(result.invalidGroupIds);
      }
      return { wish: result.wish, changes: result.changes };
    },

    async deleteWish(input: {
      wishId: string;
      ownerId: string;
      now?: Date;
    }): Promise<boolean> {
      const deleted = await repository.deleteWish({
        wishId: requireIdentifier(input.wishId),
        ownerId: requireActor(input.ownerId),
        now: input.now ?? new Date(),
      });
      if (!deleted) {
        throw new WishServiceError(
          "wish_access_denied",
          "Der Wunsch wurde nicht gefunden oder gehört nicht dir.",
        );
      }
      return true;
    },
  };
}

export type WishService = ReturnType<typeof createWishService>;

export type { WishRecord, WishValues } from "./wish-repository";
export type { CreateWishRepositoryInput } from "./wish-repository";
