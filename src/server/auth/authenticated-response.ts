import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { issuedSessionCookie } from "./session-cookie";
import { rotateSession, type IssuedSession } from "./session-service";
import { sessionTokenFromRequest } from "./request-security";

export function authenticatedJsonResponse(
  session: IssuedSession,
  body: Record<string, unknown> = { ok: true },
): NextResponse {
  const response = NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
  response.cookies.set(
    issuedSessionCookie(session.token, session.absoluteExpiresAt),
  );
  return response;
}

/** Shared by passkey and password auth so cookie/session semantics cannot drift. */
export async function rotateAuthenticatedResponse(
  request: NextRequest,
  userId: string,
  body: Record<string, unknown> = { ok: true },
): Promise<NextResponse> {
  const session = await rotateSession({
    userId,
    previousToken: sessionTokenFromRequest(request),
  });
  return authenticatedJsonResponse(session, body);
}
