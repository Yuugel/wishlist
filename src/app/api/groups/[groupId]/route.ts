import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import {
  getGroupService,
  groupErrorResponse,
  isUuid,
  NO_STORE_HEADERS,
  serializeGroupDetails,
} from "../_utils";

type RouteContext = {
  params: Promise<{ groupId: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
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
    const group = await groupService.getGroup({
      groupId,
      userId: session.userId,
    });
    return NextResponse.json(
      { group: serializeGroupDetails(group) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return groupErrorResponse(error);
  }
}
