import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import { beginAdditionalCredential } from "@/server/auth/passkey-service";
import { readAuthJson } from "@/server/auth/request-security";
import { authErrorResponse } from "@/server/auth/route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await readAuthJson(request);
    const session = await requireSession(request);
    return NextResponse.json(await beginAdditionalCredential(session));
  } catch (error) {
    return authErrorResponse(error);
  }
}
