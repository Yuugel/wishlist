import { NextResponse, type NextRequest } from "next/server";
import { beginSignup } from "@/server/auth/passkey-service";
import { readAuthJson } from "@/server/auth/request-security";
import { authErrorResponse } from "@/server/auth/route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(await beginSignup(await readAuthJson(request)));
  } catch (error) {
    return authErrorResponse(error);
  }
}
