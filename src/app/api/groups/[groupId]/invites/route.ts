import { NextResponse } from "next/server";
import {
  getCurrentUserId,
  getGroupService,
  groupErrorResponse,
  isUuid,
  rejectCrossOriginMutation,
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
    const invite = await groupService.createInvite({ groupId, userId });
    return NextResponse.json({
      token: invite.token,
      expiresAt: invite.expiresAt.toISOString(),
    });
  } catch (error) {
    return groupErrorResponse(error);
  }
}
