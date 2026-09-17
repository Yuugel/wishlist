import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const GROUP_INVITE_PREFIX = "wgi1_";
const SELECTOR_BYTES = 16;
const SECRET_BYTES = 32;
const SELECTOR_LENGTH = 22;
const SECRET_LENGTH = 43;
const TOKEN_PATTERN = new RegExp(
  `^${GROUP_INVITE_PREFIX}([A-Za-z0-9_-]{${SELECTOR_LENGTH}})\\.([A-Za-z0-9_-]{${SECRET_LENGTH}})$`,
);
const DIGEST_DOMAIN = "wishlist:group-invite:v1\0";

export type GeneratedGroupInviteToken = {
  token: string;
  selector: string;
  digest: Buffer;
};

export type ParsedGroupInviteToken = {
  selector: string;
  secret: string;
};

function digestInviteSecret(selector: string, secret: string): Buffer {
  return createHash("sha256")
    .update(DIGEST_DOMAIN, "ascii")
    .update(selector, "ascii")
    .update(".", "ascii")
    .update(secret, "ascii")
    .digest();
}

/**
 * Creates a bearer invite token. Only the selector and digest belong in the
 * database; the returned token must only be shown to the authenticated caller.
 */
export function generateGroupInviteToken(): GeneratedGroupInviteToken {
  const selector = randomBytes(SELECTOR_BYTES).toString("base64url");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");

  return {
    token: `${GROUP_INVITE_PREFIX}${selector}.${secret}`,
    selector,
    digest: digestInviteSecret(selector, secret),
  };
}

export function parseGroupInviteToken(
  value: string,
): ParsedGroupInviteToken | null {
  const match = TOKEN_PATTERN.exec(value);
  if (!match || match[0] !== value) return null;

  const [, selector, secret] = match;
  if (
    Buffer.from(selector, "base64url").byteLength !== SELECTOR_BYTES ||
    Buffer.from(secret, "base64url").byteLength !== SECRET_BYTES
  ) {
    return null;
  }

  return { selector, secret };
}

export function digestGroupInviteToken(value: string): Buffer | null {
  const parsed = parseGroupInviteToken(value);
  return parsed ? digestInviteSecret(parsed.selector, parsed.secret) : null;
}

export function verifyGroupInviteToken(input: {
  candidate: string;
  selector: string;
  persistedDigest: Uint8Array;
}): boolean {
  const parsed = parseGroupInviteToken(input.candidate);
  if (!parsed || parsed.selector !== input.selector) return false;

  const actual = digestInviteSecret(parsed.selector, parsed.secret);
  const expected = Buffer.from(input.persistedDigest);
  return (
    actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
  );
}

export function isGroupInviteToken(value: string): boolean {
  return parseGroupInviteToken(value) !== null;
}
