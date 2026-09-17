import "server-only";

import { NextResponse } from "next/server";
import { AuthError } from "./auth-error";

export function authErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.code, message: error.publicMessage },
      { status: error.status },
    );
  }
  return NextResponse.json(
    {
      error: "server_error",
      message: "Die Anfrage ist fehlgeschlagen. Bitte versuche es erneut.",
    },
    { status: 500 },
  );
}
