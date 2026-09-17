import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import {
  getGroupService,
  groupErrorResponse,
  isUuid,
  NO_STORE_HEADERS,
  readJsonBody,
  rejectCrossOriginMutation,
  serializeGroup,
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

    let confirmed = false;
    if (request.headers.get("content-type")) {
      const body = await readJsonBody(request);
      if (
        !body ||
        (body.confirmed !== undefined && typeof body.confirmed !== "boolean")
      ) {
        return NextResponse.json(
          { error: "invalid_request" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      confirmed = body.confirmed === true;
    }

    const groupService = await getGroupService();
    const result = await groupService.leaveGroup({
      groupId,
      userId: session.userId,
      confirmed,
    });
    if (result.requiresConfirmation) {
      return NextResponse.json(
        {
          error: "leave_confirmation_required",
          requiresConfirmation: true,
          message:
            "Durch den Austritt würden aktive Übernahmen ihre letzte gemeinsame Sichtbarkeit verlieren.",
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      {
        requiresConfirmation: false,
        dissolved: result.dissolved,
        group: result.group ? serializeGroup(result.group) : null,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return groupErrorResponse(error);
  }
}
