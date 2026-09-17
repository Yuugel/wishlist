import { NextResponse, type NextRequest } from "next/server";
import { finishSignup } from "@/server/auth/passkey-service";
import { readAuthJson, sessionTokenFromRequest } from "@/server/auth/request-security";
import { authErrorResponse } from "@/server/auth/route-response";
import { issuedSessionCookie } from "@/server/auth/session-cookie";
import { rotateSession } from "@/server/auth/session-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const result = await finishSignup(await readAuthJson(request));
    const session = await rotateSession({
      userId: result.userId,
      previousToken: sessionTokenFromRequest(request),
    });
    const response = NextResponse.json(
      { ok: true, recoveryCode: result.recoveryCode },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(issuedSessionCookie(session.token, session.absoluteExpiresAt));
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}
