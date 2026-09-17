import { NextResponse, type NextRequest } from "next/server";
import { beginAuthentication } from "@/server/auth/passkey-service";
import { readAuthJson } from "@/server/auth/request-security";
import { authErrorResponse } from "@/server/auth/route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await readAuthJson(request);
    return NextResponse.json(await beginAuthentication());
  } catch (error) {
    return authErrorResponse(error);
  }
}
