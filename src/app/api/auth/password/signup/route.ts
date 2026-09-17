import type { NextRequest } from "next/server";
import { rotateAuthenticatedResponse } from "@/server/auth/authenticated-response";
import { emailCandidate } from "@/server/auth/password-input";
import { enforcePasswordRateLimit } from "@/server/auth/password-rate-limit";
import { signupWithPassword } from "@/server/auth/password-service";
import { readAuthJson } from "@/server/auth/request-security";
import { authErrorResponse } from "@/server/auth/route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readAuthJson(request);
    enforcePasswordRateLimit(request, "signup", emailCandidate(body));
    const result = await signupWithPassword(body);
    return rotateAuthenticatedResponse(request, result.userId, {
      ok: true,
      recoveryCode: result.recoveryCode,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
