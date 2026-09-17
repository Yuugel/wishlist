import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import {
  getWishService,
  isUuid,
  NO_STORE_HEADERS,
  readJsonBody,
  rejectCrossOriginMutation,
  serializeChanges,
  serializeOwnerWish,
  wishErrorResponse,
} from "../_utils";

type RouteContext = {
  params: Promise<{ wishId: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function updateWish(request: NextRequest, context: RouteContext) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) return crossOriginResponse;

  try {
    const session = await requireSession(request);
    const { wishId } = await context.params;
    if (!isUuid(wishId)) {
      return NextResponse.json(
        { error: "wish_access_denied" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const body = await readJsonBody(request);
    if (!body) {
      return NextResponse.json(
        { error: "invalid_request", message: "Ungültiger Anfrageinhalt." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const service = await getWishService();
    const result = await service.updateWish({
      wishId,
      ownerId: session.userId,
      title: body.title as string | null | undefined,
      description: body.description as string | null | undefined,
      link: body.link as string | null | undefined,
      priceText: body.priceText as string | null | undefined,
      groupIds: body.groupIds as string[] | null | undefined,
    });
    return NextResponse.json(
      {
        wish: serializeOwnerWish(result.wish),
        changes: serializeChanges(result.changes),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return wishErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return updateWish(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return updateWish(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) return crossOriginResponse;

  try {
    const session = await requireSession(request);
    const { wishId } = await context.params;
    if (!isUuid(wishId)) {
      return NextResponse.json(
        { error: "wish_access_denied" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const service = await getWishService();
    await service.deleteWish({ wishId, ownerId: session.userId });
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return wishErrorResponse(error);
  }
}
