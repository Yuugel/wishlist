const NOT_ALLOWED_MESSAGE =
  "Der Passkey-Vorgang wurde abgebrochen, ist abgelaufen oder auf diesem Gerät ist kein passender Passkey verfügbar.";

export function webAuthnErrorMessage(error: unknown): string {
  const name = typeof error === "object" && error !== null && "name" in error
    ? String(error.name)
    : "";
  const message = error instanceof Error ? error.message : "";

  if (
    name === "NotAllowedError" ||
    name === "AbortError" ||
    /operation either timed out or was not allowed/i.test(message) ||
    /\b(?:timed out|timeout|not allowed|cancelled|canceled|aborted)\b/i.test(message)
  ) {
    return NOT_ALLOWED_MESSAGE;
  }
  if (name === "InvalidStateError") {
    return "Dieser Passkey ist für das Konto bereits registriert.";
  }
  if (name.endsWith("Error") && /webauthn|credential|authenticator/i.test(message)) {
    return "Der Browser konnte den Passkey-Vorgang nicht abschließen.";
  }
  if (message) return message;
  return "Der Passkey-Vorgang ist fehlgeschlagen.";
}
