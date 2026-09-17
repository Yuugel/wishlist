import { NextResponse } from "next/server";
import { AuthError } from "@/server/auth/auth-error";
import { authErrorResponse } from "@/server/auth/route-response";
import { GroupServiceError } from "@/server/groups/group-service";
import type { GroupDetails, GroupSummary } from "@/server/groups/group-types";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function getGroupService() {
  const serviceModule = await import("@/server/groups/service");
  return serviceModule.groupService;
}

/** Reject an explicitly cross-origin mutation while allowing non-browser API clients. */
export function rejectCrossOriginMutation(
  request: Request,
): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  try {
    if (new URL(origin).origin !== new URL(request.url).origin) {
      return NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
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
  if (error instanceof AuthError) return authErrorResponse(error);

  if (error instanceof GroupServiceError) {
    const status =
      error.code === "invalid_group_name" || error.code === "invalid_invite"
        ? 400
        : 404;
    return NextResponse.json(
      { error: error.code },
      { status, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    { error: "server_error" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

const MAX_GROUP_BODY_BYTES = 8 * 1024;

export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") return null;

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const bytes = Number(contentLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_GROUP_BODY_BYTES) {
      return null;
    }
  }

  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_GROUP_BODY_BYTES) return null;
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
