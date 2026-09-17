import { NextResponse } from "next/server";
import {
  getCurrentUserId,
  getGroupService,
  groupErrorResponse,
  readJsonBody,
  rejectCrossOriginMutation,
  serializeGroup,
  unauthorizedResponse,
} from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) return crossOriginResponse;

  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const body = await readJsonBody(request);
  if (!body || typeof body.token !== "string") {
    return NextResponse.json({ error: "invalid_invite" }, { status: 400 });
  }

  try {
    const groupService = await getGroupService();
    const result = await groupService.joinGroup({
      token: body.token,
      userId,
    });
    return NextResponse.json({
      joined: result.joined,
      group: serializeGroup(result.group),
    });
  } catch (error) {
    return groupErrorResponse(error);
  }
}
