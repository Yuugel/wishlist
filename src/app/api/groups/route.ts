import { NextResponse } from "next/server";
import {
  getCurrentUserId,
  getGroupService,
  rejectCrossOriginMutation,
  groupErrorResponse,
  readJsonBody,
  serializeGroup,
  unauthorizedResponse,
} from "./_utils";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  try {
    const groupService = await getGroupService();
    const groups = await groupService.listGroups({ userId });
    return NextResponse.json({ groups: groups.map(serializeGroup) });
  } catch (error) {
    return groupErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) return crossOriginResponse;

  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const body = await readJsonBody(request);
  if (!body || typeof body.name !== "string") {
    return NextResponse.json({ error: "invalid_group_name" }, { status: 400 });
  }

  try {
    const groupService = await getGroupService();
    const group = await groupService.createGroup({
      userId,
      name: body.name,
    });
    return NextResponse.json({ group: serializeGroup(group) }, { status: 201 });
  } catch (error) {
    return groupErrorResponse(error);
  }
}
