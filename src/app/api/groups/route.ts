import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import {
  getGroupService,
  groupErrorResponse,
  NO_STORE_HEADERS,
  readJsonBody,
  rejectCrossOriginMutation,
  serializeGroup,
} from "./_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request);
    const groupService = await getGroupService();
    const groups = await groupService.listGroups({ userId: session.userId });
    return NextResponse.json(
      { groups: groups.map(serializeGroup) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return groupErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) return crossOriginResponse;

  try {
    const session = await requireSession(request);
    const body = await readJsonBody(request);
    if (!body || typeof body.name !== "string") {
      return NextResponse.json(
        { error: "invalid_group_name" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const groupService = await getGroupService();
    const group = await groupService.createGroup({
      userId: session.userId,
      name: body.name,
    });
    return NextResponse.json(
      { group: serializeGroup(group) },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return groupErrorResponse(error);
  }
}
