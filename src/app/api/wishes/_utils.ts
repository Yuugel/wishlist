import { NextResponse } from "next/server";
import { AuthError } from "@/server/auth/auth-error";
import { authErrorResponse } from "@/server/auth/route-response";
import { TakeoverServiceError } from "@/server/takeovers/takeover-service";
import { WishServiceError } from "@/server/wishes/wish-service";
import {
  serializeOwnerWishView,
  toOwnerWishView,
} from "@/server/wishes/wish-view";
import type { WishChangeSet, WishRecord } from "@/server/wishes/wish-repository";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function getWishService() {
  const serviceModule = await import("@/server/wishes/service");
  return serviceModule.wishService;
}

export async function getTakeoverService() {
  const serviceModule = await import("@/server/takeovers/service");
  return serviceModule.takeoverService;
}

/** Reject an explicitly cross-origin mutation while allowing non-browser API clients. */
export function rejectCrossOriginMutation(
  request: Request,
): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  try {
    if (new URL(origin).origin !== new URL(request.url).origin) {
      return NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  return null;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function serializeOwnerWish(wish: WishRecord) {
  return serializeOwnerWishView(toOwnerWishView(wish));
}

/** Kept as a compatibility name for the owner-only wish endpoint. */
export function serializeWish(wish: WishRecord) {
  return serializeOwnerWish(wish);
}

export function serializeChanges(changes: WishChangeSet) {
  return {
    changedFields: changes.changedFields,
    addedGroupIds: changes.addedGroupIds,
    removedGroupIds: changes.removedGroupIds,
    isNoop: changes.isNoop,
  };
}

export function takeoverErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) return authErrorResponse(error);

  if (error instanceof TakeoverServiceError) {
    const status = error.code === "takeover_access_denied" ? 404 : 409;
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    { error: "server_error" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

export function wishErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) return authErrorResponse(error);

  if (error instanceof WishServiceError) {
    const status =
      error.code === "wish_access_denied" ? 404 : 400;
    return NextResponse.json(
      {
        error: error.code,
        message: error.message,
        ...(error.invalidGroupIds.length > 0
          ? { invalidGroupIds: error.invalidGroupIds }
          : {}),
      },
      { status, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    { error: "server_error" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

const MAX_WISH_BODY_BYTES = 16 * 1024;

export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") return null;

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const bytes = Number(contentLength);
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > MAX_WISH_BODY_BYTES
    ) {
      return null;
    }
  }

  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_WISH_BODY_BYTES) return null;
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
