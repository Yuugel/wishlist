import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/server/auth/session-context";
import { GroupServiceError } from "@/server/groups/group-service";
import type { GroupDetails, GroupSummary } from "@/server/groups/group-types";

export async function getGroupService() {
  const serviceModule = await import("@/server/groups/service");
  return serviceModule.groupService;
}

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getAuthenticatedSession();
  return session?.userId ?? null;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/** Reject an explicitly cross-origin mutation while allowing non-browser API clients. */
export function rejectCrossOriginMutation(
  request: Request,
): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  try {
    if (new URL(origin).origin !== new URL(request.url).origin) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return null;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function serializeGroup(group: GroupSummary) {
  return {
    id: group.id,
    name: group.name,
    createdAt: group.createdAt.toISOString(),
  };
}

export function serializeGroupDetails(group: GroupDetails) {
  return {
    ...serializeGroup(group),
    members: group.members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
    })),
  };
}

export function groupErrorResponse(error: unknown): NextResponse {
  if (error instanceof GroupServiceError) {
    const status =
      error.code === "invalid_group_name" || error.code === "invalid_invite"
        ? 400
        : 404;
    return NextResponse.json({ error: error.code }, { status });
  }

  return NextResponse.json(
    { error: "internal_server_error" },
    { status: 500 },
  );
}

export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) return null;

  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
