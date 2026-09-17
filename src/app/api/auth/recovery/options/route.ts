import { NextResponse, type NextRequest } from "next/server";
import {
  beginRecoveryRegistration,
  recoveryCodeFromInput,
} from "@/server/auth/recovery-passkey-service";
import { issuedRecoveryCookie } from "@/server/auth/recovery-cookie";
import { enforceRecoveryClaimRateLimit } from "@/server/auth/recovery-rate-limit";
import { readAuthJson } from "@/server/auth/request-security";
import { authErrorResponse } from "@/server/auth/route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readAuthJson(request);
    const candidate = recoveryCodeFromInput(body);
    enforceRecoveryClaimRateLimit(request, candidate);
    const result = await beginRecoveryRegistration(body);
    const response = NextResponse.json(
      { ceremonyId: result.ceremonyId, options: result.options },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(
      issuedRecoveryCookie(result.claimToken, result.expiresAt),
    );
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}
