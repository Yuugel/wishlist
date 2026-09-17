import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import {
  getWishService,
  NO_STORE_HEADERS,
  readJsonBody,
  rejectCrossOriginMutation,
  serializeWish,
  wishErrorResponse,
} from "./_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request);
    const service = await getWishService();
    const wishes = await service.listWishes({ ownerId: session.userId });
    return NextResponse.json(
      { wishes: wishes.map(serializeWish) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return wishErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const crossOriginResponse = rejectCrossOriginMutation(request);
  if (crossOriginResponse) return crossOriginResponse;

  try {
    const session = await requireSession(request);
    const body = await readJsonBody(request);
    if (!body) {
      return NextResponse.json(
        { error: "invalid_request", message: "Ungültiger Anfrageinhalt." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const service = await getWishService();
    const wish = await service.createWish({
      ownerId: session.userId,
      title: body.title as string,
      description: body.description as string | null | undefined,
      link: body.link as string | null | undefined,
      priceText: body.priceText as string | null | undefined,
      groupIds: body.groupIds as string[] | null | undefined,
    });
    return NextResponse.json(
      { wish: serializeWish(wish) },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return wishErrorResponse(error);
  }
}
