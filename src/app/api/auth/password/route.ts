import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import { enforcePasswordRateLimit } from "@/server/auth/password-rate-limit";
import { addPasswordToAccount } from "@/server/auth/password-service";
import { readAuthJson } from "@/server/auth/request-security";
import { authErrorResponse } from "@/server/auth/route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readAuthJson(request);
    const session = await requireSession(request);
    enforcePasswordRateLimit(request, "set", session.userId);
    await addPasswordToAccount(session, body);
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
