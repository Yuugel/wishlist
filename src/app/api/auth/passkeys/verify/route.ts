import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import { finishAdditionalCredential } from "@/server/auth/passkey-service";
import { readAuthJson } from "@/server/auth/request-security";
import { authErrorResponse } from "@/server/auth/route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readAuthJson(request);
    const session = await requireSession(request);
    await finishAdditionalCredential(session, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
