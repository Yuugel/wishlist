import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import {
  getGroupService,
  groupErrorResponse,
  isUuid,
  NO_STORE_HEADERS,
  rejectCrossOriginMutation,
} from "../../_utils";

type RouteContext = {
  params: Promise<{ groupId: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: RouteContext) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) return crossOriginResponse;

  try {
    const session = await requireSession(request);
    const { groupId } = await context.params;
    if (!isUuid(groupId)) {
      return NextResponse.json(
        { error: "group_access_denied" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const groupService = await getGroupService();
    const invite = await groupService.createInvite({
      groupId,
      userId: session.userId,
    });
    return NextResponse.json(
      {
        token: invite.token,
        expiresAt: invite.expiresAt.toISOString(),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return groupErrorResponse(error);
  }
}
