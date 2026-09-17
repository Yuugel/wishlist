import { NextResponse, type NextRequest } from "next/server";
import {
  finishRecoveryRegistration,
} from "@/server/auth/recovery-passkey-service";
import {
  clearedRecoveryCookie,
  RECOVERY_COOKIE_NAME,
} from "@/server/auth/recovery-cookie";
import { readAuthJson } from "@/server/auth/request-security";
import { authErrorResponse } from "@/server/auth/route-response";
import { issuedSessionCookie } from "@/server/auth/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const result = await finishRecoveryRegistration(
      request.cookies.get(RECOVERY_COOKIE_NAME)?.value,
      await readAuthJson(request),
    );
    const response = NextResponse.json(
      { ok: true, recoveryCode: result.recoveryCode },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(
      issuedSessionCookie(
        result.session.token,
        result.session.absoluteExpiresAt,
      ),
    );
    response.cookies.set(clearedRecoveryCookie());
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}
