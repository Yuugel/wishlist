import type { NextRequest } from "next/server";
import { rotateAuthenticatedResponse } from "@/server/auth/authenticated-response";
import { finishAuthentication } from "@/server/auth/passkey-service";
import { readAuthJson } from "@/server/auth/request-security";
import { authErrorResponse } from "@/server/auth/route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const result = await finishAuthentication(await readAuthJson(request));
    return rotateAuthenticatedResponse(request, result.userId);
  } catch (error) {
    return authErrorResponse(error);
  }
}
