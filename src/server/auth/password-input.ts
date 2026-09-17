import "server-only";

import { AuthError, authenticationFailed, invalidRequest } from "./auth-error";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
const MAX_PASSWORD_BYTES = 1_024;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeEmail(value: unknown): {
  email: string;
  emailNormalized: string;
} {
  if (typeof value !== "string") throw invalidRequest();
  const email = value.trim();
  if (email.length === 0 || email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw invalidRequest();
  }
  return { email, emailNormalized: email.toLowerCase() };
}

export function normalizeOptionalEmail(value: unknown): {
  email: string | null;
  emailNormalized: string | null;
} {
  if (value === undefined || value === null || value === "") {
    return { email: null, emailNormalized: null };
  }
  return normalizeEmail(value);
}

function displayName(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length < 1 || normalized.length > 200) {
    throw invalidRequest();
  }
  return normalized;
}

function validPassword(value: unknown): value is string {
  return typeof value === "string" &&
    Array.from(value).length >= MIN_PASSWORD_LENGTH &&
    Array.from(value).length <= MAX_PASSWORD_LENGTH &&
    Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES;
}

function newPassword(value: unknown): string {
  if (!validPassword(value)) {
    throw new AuthError(
      "password_policy_failed",
      400,
      `Das Passwort muss zwischen ${MIN_PASSWORD_LENGTH} und ${MAX_PASSWORD_LENGTH} Zeichen lang sein.`,
    );
  }
  return value;
}

export function parsePasswordSignup(value: unknown): {
  displayName: string;
  email: string;
  emailNormalized: string;
  password: string;
} {
  const input = object(value);
  if (!input) throw invalidRequest();
  return {
    displayName: displayName(input.displayName),
    ...normalizeEmail(input.email),
    password: newPassword(input.password),
  };
}

export function parsePasswordLogin(value: unknown): {
  emailNormalized: string;
  password: string;
} {
  const input = object(value);
  if (!input || typeof input.password !== "string") {
    throw authenticationFailed("E-Mail oder Passwort ist nicht korrekt.");
  }
  try {
    const email = normalizeEmail(input.email);
    if (!validPassword(input.password)) throw new Error("invalid password");
    return { emailNormalized: email.emailNormalized, password: input.password };
  } catch {
    throw authenticationFailed("E-Mail oder Passwort ist nicht korrekt.");
  }
}

export function parseNewPassword(value: unknown): string {
  const input = object(value);
  if (!input) throw invalidRequest();
  return newPassword(input.password);
}

/** A privacy-preserving rate-limit key; validation remains inside the service. */
export function emailCandidate(value: unknown): string {
  const input = object(value);
  return typeof input?.email === "string"
    ? input.email.trim().toLowerCase().slice(0, 320)
    : "invalid";
}
