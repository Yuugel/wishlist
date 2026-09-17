import "server-only";

import type { NextRequest } from "next/server";
import { AuthError, invalidRequest } from "./auth-error";
import { getWebAuthnConfig } from "./auth-config";

const MAX_AUTH_BODY_BYTES = 128 * 1024;

/**
 * Central policy point for mutating auth routes. A deployment can put an
 * IP/device rate limiter in front of this function without changing ceremony
 * semantics; per-ceremony verification attempts are also bounded in PostgreSQL.
 */
export function enforceAuthMutationRequest(request: Request): void {
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") throw invalidRequest();

  if (request.headers.get("origin") !== getWebAuthnConfig().origin) {
    throw new AuthError(
      "origin_not_allowed",
      403,
      "Diese Anfrage ist von diesem Ursprung nicht erlaubt.",
    );
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const bytes = Number(contentLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_AUTH_BODY_BYTES) {
      throw invalidRequest();
    }
  }
}

export async function readAuthJson(request: Request): Promise<unknown> {
  enforceAuthMutationRequest(request);
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_AUTH_BODY_BYTES) {
      throw invalidRequest();
    }
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw invalidRequest();
  }
}

export function sessionTokenFromRequest(request: NextRequest): string | undefined {
  return request.cookies.get("__Host-wishlist-session")?.value;
}
