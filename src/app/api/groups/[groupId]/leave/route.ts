import { NextResponse } from "next/server";
import {
  getCurrentUserId,
  getGroupService,
  groupErrorResponse,
  isUuid,
  rejectCrossOriginMutation,
  serializeGroup,
  unauthorizedResponse,
} from "../../_utils";

type RouteContext = {
  params: Promise<{ groupId: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) return crossOriginResponse;

  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return NextResponse.json({ error: "group_access_denied" }, { status: 404 });
  }

  try {
    const groupService = await getGroupService();
    const result = await groupService.leaveGroup({ groupId, userId });
    return NextResponse.json({
      dissolved: result.dissolved,
      group: result.group ? serializeGroup(result.group) : null,
    });
  } catch (error) {
    return groupErrorResponse(error);
  }
}
