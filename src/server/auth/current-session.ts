import "server-only";

import type { NextRequest } from "next/server";
import { AuthError } from "./auth-error";
import { sessionTokenFromRequest } from "./request-security";
import { resolveSession } from "./session-service";

export async function requireSession(request: NextRequest) {
  const token = sessionTokenFromRequest(request);
  const session = token ? await resolveSession(token) : null;
  if (!session) {
    throw new AuthError(
      "authentication_required",
      401,
      "Bitte melde dich an.",
    );
  }
  return session;
}
