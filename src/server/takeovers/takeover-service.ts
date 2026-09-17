import "server-only";

import type {
  TakeoverRepository,
  TakeoverStatus,
  ViewerTakeoverStatus,
} from "./takeover-repository";

export type TakeoverServiceErrorCode =
  | "takeover_access_denied"
  | "wish_already_taken"
  | "invalid_takeover_transition";

export class TakeoverServiceError extends Error {
  constructor(
    public readonly code: TakeoverServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TakeoverServiceError";
  }
}

export type TakeoverDomainEvent = {
  type:
    | "wish_reserved"
    | "wish_marked_purchased"
    | "wish_returned_to_reserved"
    | "wish_released";
  wishId: string;
  actorId: string;
  previousStatus: "available" | TakeoverStatus;
  status: "available" | TakeoverStatus;
  occurredAt: Date;
};

export type TakeoverMutation = {
  viewerStatus: ViewerTakeoverStatus;
  event: TakeoverDomainEvent;
};

function requireIdentifier(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw accessDenied();
  }
  return value.trim();
}

function accessDenied(): TakeoverServiceError {
  return new TakeoverServiceError(
    "takeover_access_denied",
    "Der Wunsch wurde nicht gefunden oder ist für dich nicht verfügbar.",
  );
}

function invalidTransition(): TakeoverServiceError {
  return new TakeoverServiceError(
    "invalid_takeover_transition",
    "Dieser Statuswechsel ist nicht erlaubt.",
  );
}

export function toViewerTakeoverStatus(
  status: TakeoverStatus | null,
  isTakenByViewer: boolean,
): ViewerTakeoverStatus {
  if (status === null) return "available";
  if (status === "reserved") {
    return isTakenByViewer ? "reserved_by_you" : "reserved";
  }
  return isTakenByViewer ? "purchased_by_you" : "purchased";
}

export function createTakeoverService(repository: TakeoverRepository) {
  function input(value: {
    wishId: string;
    actorId: string;
    now?: Date;
  }) {
    return {
      wishId: requireIdentifier(value.wishId),
      actorId: requireIdentifier(value.actorId),
      now: value.now ?? new Date(),
    };
  }

  return {
    async reserveWish(value: {
      wishId: string;
      actorId: string;
      now?: Date;
    }): Promise<TakeoverMutation> {
      const normalized = input(value);
      const result = await repository.reserve(normalized);
      if (result.kind === "access-denied") throw accessDenied();
      if (result.kind === "already-taken") {
        throw new TakeoverServiceError(
          "wish_already_taken",
          "Der Wunsch wurde bereits von jemandem übernommen.",
        );
      }
      return {
        viewerStatus: "reserved_by_you",
        event: {
          type: "wish_reserved",
          wishId: result.takeover.wishId,
          actorId: result.takeover.takerId,
          previousStatus: "available",
          status: "reserved",
          occurredAt: result.takeover.updatedAt,
        },
      };
    },

    async markPurchased(value: {
      wishId: string;
      actorId: string;
      now?: Date;
    }): Promise<TakeoverMutation> {
      const normalized = input(value);
      const result = await repository.transition({
        ...normalized,
        from: "reserved",
        to: "purchased",
      });
      if (result.kind === "access-denied") throw accessDenied();
      if (result.kind === "invalid-transition") throw invalidTransition();
      return {
        viewerStatus: "purchased_by_you",
        event: {
          type: "wish_marked_purchased",
          wishId: result.takeover.wishId,
          actorId: result.takeover.takerId,
          previousStatus: "reserved",
          status: "purchased",
          occurredAt: result.takeover.updatedAt,
        },
      };
    },

    async markReserved(value: {
      wishId: string;
      actorId: string;
      now?: Date;
    }): Promise<TakeoverMutation> {
      const normalized = input(value);
      const result = await repository.transition({
        ...normalized,
        from: "purchased",
        to: "reserved",
      });
      if (result.kind === "access-denied") throw accessDenied();
      if (result.kind === "invalid-transition") throw invalidTransition();
      return {
        viewerStatus: "reserved_by_you",
        event: {
          type: "wish_returned_to_reserved",
          wishId: result.takeover.wishId,
          actorId: result.takeover.takerId,
          previousStatus: "purchased",
          status: "reserved",
          occurredAt: result.takeover.updatedAt,
        },
      };
    },

    async releaseWish(value: {
      wishId: string;
      actorId: string;
      now?: Date;
    }): Promise<TakeoverMutation> {
      const normalized = input(value);
      const result = await repository.release(normalized);
      if (result.kind === "access-denied") throw accessDenied();
      if (result.kind === "invalid-transition") throw invalidTransition();
      return {
        viewerStatus: "available",
        event: {
          type: "wish_released",
          wishId: result.takeover.wishId,
          actorId: result.takeover.takerId,
          previousStatus: "reserved",
          status: "available",
          occurredAt: normalized.now,
        },
      };
    },

    async getViewerStatus(value: {
      wishId: string;
      actorId: string;
    }): Promise<ViewerTakeoverStatus> {
      const result = await repository.getViewerStatus({
        wishId: requireIdentifier(value.wishId),
        actorId: requireIdentifier(value.actorId),
      });
      if (result.kind === "access-denied") throw accessDenied();
      return toViewerTakeoverStatus(result.status, result.isTakenByViewer);
    },
  };
}

export type TakeoverService = ReturnType<typeof createTakeoverService>;
