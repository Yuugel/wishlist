import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import {
  getGroupService,
  groupErrorResponse,
  NO_STORE_HEADERS,
  readJsonBody,
  rejectCrossOriginMutation,
  serializeGroup,
} from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) return crossOriginResponse;

  try {
    const session = await requireSession(request);
    const body = await readJsonBody(request);
    if (!body || typeof body.token !== "string") {
      return NextResponse.json(
        { error: "invalid_invite" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const groupService = await getGroupService();
    const result = await groupService.joinGroup({
      token: body.token,
      userId: session.userId,
    });
    return NextResponse.json(
      {
        joined: result.joined,
        group: serializeGroup(result.group),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return groupErrorResponse(error);
  }
}
