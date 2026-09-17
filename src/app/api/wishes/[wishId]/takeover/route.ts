import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import type { TakeoverMutation } from "@/server/takeovers/takeover-service";
import {
  getTakeoverService,
  isUuid,
  NO_STORE_HEADERS,
  readJsonBody,
  rejectCrossOriginMutation,
  takeoverErrorResponse,
} from "../../_utils";

type RouteContext = {
  params: Promise<{ wishId: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function invalidRequest() {
  return NextResponse.json(
    { error: "invalid_request", message: "Ungültiger Anfrageinhalt." },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

function serializeMutation(result: TakeoverMutation) {
  return {
    takeoverStatus: result.viewerStatus,
    event: {
      type: result.event.type,
      wishId: result.event.wishId,
      previousStatus: result.event.previousStatus,
      status: result.event.status,
      occurredAt: result.event.occurredAt.toISOString(),
    },
  };
}

async function contextFor(request: NextRequest, context: RouteContext) {
  const session = await requireSession(request);
  const { wishId } = await context.params;
  if (!isUuid(wishId)) return null;
  return { actorId: session.userId, wishId };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) return crossOriginResponse;

  try {
    const actor = await contextFor(request, context);
    if (!actor) {
      return NextResponse.json(
        { error: "takeover_access_denied" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    const service = await getTakeoverService();
    const result = await service.reserveWish(actor);
    return NextResponse.json(serializeMutation(result), {
      status: 201,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return takeoverErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) return crossOriginResponse;

  try {
    const actor = await contextFor(request, context);
    if (!actor) {
      return NextResponse.json(
        { error: "takeover_access_denied" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    const body = await readJsonBody(request);
    if (!body || (body.status !== "purchased" && body.status !== "reserved")) {
      return invalidRequest();
    }

    const service = await getTakeoverService();
    const result = body.status === "purchased"
      ? await service.markPurchased(actor)
      : await service.markReserved(actor);
    return NextResponse.json(serializeMutation(result), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return takeoverErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) return crossOriginResponse;

  try {
    const actor = await contextFor(request, context);
    if (!actor) {
      return NextResponse.json(
        { error: "takeover_access_denied" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    const service = await getTakeoverService();
    const result = await service.releaseWish(actor);
    return NextResponse.json(serializeMutation(result), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return takeoverErrorResponse(error);
  }
}
