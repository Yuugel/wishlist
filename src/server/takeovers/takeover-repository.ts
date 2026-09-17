export type TakeoverStatus = "reserved" | "purchased";

export type ViewerTakeoverStatus =
  | "available"
  | "reserved_by_you"
  | "reserved"
  | "purchased_by_you"
  | "purchased";

export type TakeoverRecord = {
  wishId: string;
  takerId: string;
  status: TakeoverStatus;
  purchasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TakeoverMutationInput = {
  wishId: string;
  actorId: string;
  now: Date;
};

export type ReserveTakeoverResult =
  | { kind: "reserved"; takeover: TakeoverRecord }
  | { kind: "already-taken" }
  | { kind: "access-denied" };

export type TransitionTakeoverResult =
  | { kind: "transitioned"; takeover: TakeoverRecord }
  | { kind: "invalid-transition" }
  | { kind: "access-denied" };

export type ReleaseTakeoverResult =
  | { kind: "released"; takeover: TakeoverRecord }
  | { kind: "invalid-transition" }
  | { kind: "access-denied" };

export type ViewerTakeoverResult =
  | {
      kind: "visible";
      status: TakeoverStatus | null;
      isTakenByViewer: boolean;
    }
  | { kind: "access-denied" };

export interface TakeoverRepository {
  reserve(input: TakeoverMutationInput): Promise<ReserveTakeoverResult>;
  transition(
    input: TakeoverMutationInput & {
      from: TakeoverStatus;
      to: TakeoverStatus;
    },
  ): Promise<TransitionTakeoverResult>;
  release(input: TakeoverMutationInput): Promise<ReleaseTakeoverResult>;
  getViewerStatus(input: {
    wishId: string;
    actorId: string;
  }): Promise<ViewerTakeoverResult>;
}
