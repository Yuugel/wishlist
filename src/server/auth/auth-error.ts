export class AuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly publicMessage: string,
  ) {
    super(code);
    this.name = "AuthError";
  }
}

export function invalidRequest(): AuthError {
  return new AuthError(
    "invalid_request",
    400,
    "Die Anfrage konnte nicht verarbeitet werden.",
  );
}

export function authenticationFailed(
  publicMessage = "Der Passkey konnte nicht bestätigt werden.",
): AuthError {
  return new AuthError("authentication_failed", 401, publicMessage);
}
