import { and, count, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/server/auth/current-session";
import { authErrorResponse } from "@/server/auth/route-response";
import { db } from "@/server/db/client";
import {
  passwordCredentials,
  users,
  webauthnCredentials,
} from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request);
    const [[user], [credentials]] = await Promise.all([
      db
        .select({
          displayName: users.displayName,
          email: users.email,
          passwordUserId: passwordCredentials.userId,
        })
        .from(users)
        .leftJoin(
          passwordCredentials,
          eq(passwordCredentials.userId, users.id),
        )
        .where(and(eq(users.id, session.userId), eq(users.status, "active")))
        .limit(1),
      db
        .select({ count: count() })
        .from(webauthnCredentials)
        .where(
          and(
            eq(webauthnCredentials.userId, session.userId),
            isNull(webauthnCredentials.revokedAt),
          ),
        ),
    ]);
    if (!user) return NextResponse.json({ authenticated: false }, { status: 401 });
    return NextResponse.json(
      {
        authenticated: true,
        displayName: user.displayName,
        email: user.email,
        hasPassword: user.passwordUserId !== null,
        passkeyCount: credentials?.count ?? 0,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
