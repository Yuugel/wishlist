import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import { AuthError } from "@/server/auth/auth-error";
import { authErrorResponse } from "@/server/auth/route-response";
import { serializeActivity } from "@/server/activity/activity-view";
import { ActivityServiceError } from "@/server/activity/activity-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

async function getActivityService() {
  const serviceModule = await import("@/server/activity/service");
  return serviceModule.activityService;
}

function activityErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    const response = authErrorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  if (error instanceof ActivityServiceError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { error: "server_error" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request);
    const service = await getActivityService();
    const activities = await service.listActivities({ userId: session.userId });
    return NextResponse.json(
      { activities: activities.map(serializeActivity) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return activityErrorResponse(error);
  }
}
