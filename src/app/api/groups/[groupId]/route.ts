import { NextResponse } from "next/server";
import {
  getCurrentUserId,
  getGroupService,
  groupErrorResponse,
  isUuid,
  serializeGroupDetails,
  unauthorizedResponse,
} from "../_utils";

type RouteContext = {
  params: Promise<{ groupId: string }>;
};

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return NextResponse.json({ error: "group_access_denied" }, { status: 404 });
  }

  try {
    const groupService = await getGroupService();
    const group = await groupService.getGroup({ groupId, userId });
    return NextResponse.json({ group: serializeGroupDetails(group) });
  } catch (error) {
    return groupErrorResponse(error);
  }
}
