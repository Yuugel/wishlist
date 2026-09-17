import "server-only";

import { cookies } from "next/headers";
import { resolveSession, type ResolvedSession } from "./session-service";

/** The cookie name chosen by the passkey-first auth decision. */
export const SESSION_COOKIE_NAME = "__Host-wishlist-session";

/**
 * Resolves the existing auth/session foundation for a Route Handler. This is
 * deliberately only a cookie adapter; it does not create a second auth flow.
 */
export async function getAuthenticatedSession(): Promise<ResolvedSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  return resolveSession(token);
}
