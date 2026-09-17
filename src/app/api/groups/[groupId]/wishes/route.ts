import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import {
  getGroupVisibilityService,
  groupErrorResponse,
  isUuid,
  NO_STORE_HEADERS,
  serializeGroupWishVisibility,
} from "../../_utils";

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

    const visibilityService = await getGroupVisibilityService();
    const visibility = await visibilityService.listGroupWishes({
      groupId,
      userId: session.userId,
    });
    return NextResponse.json(serializeGroupWishVisibility(visibility), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return groupErrorResponse(error);
  }
}
