import { NextResponse, type NextRequest } from "next/server";
import { readAuthJson, sessionTokenFromRequest } from "@/server/auth/request-security";
import { authErrorResponse } from "@/server/auth/route-response";
import { clearedSessionCookie } from "@/server/auth/session-cookie";
import { revokeSession } from "@/server/auth/session-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await readAuthJson(request);
    const token = sessionTokenFromRequest(request);
    if (token) await revokeSession(token);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(clearedSessionCookie());
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}
