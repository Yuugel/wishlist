import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const CODE_VERSION = "wl1";
const SELECTOR_BYTES = 16;
const SECRET_BYTES = 32;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export type PersistedRecoveryCode = {
  selector: string;
  digest: Uint8Array;
  keyVersion: number;
  consumedAt: Date | null;
};

export type IssuedRecoveryCode = {
  /** Show once, then discard. Never log or persist this value. */
  displayCode: string;
  persisted: PersistedRecoveryCode;
};

function digest(
  selector: string,
  secret: string,
  pepper: Uint8Array,
): Buffer {
  return createHmac("sha256", pepper)
    .update("wishlist-recovery\0", "utf8")
    .update(selector, "ascii")
    .update("\0", "ascii")
    .update(secret, "ascii")
    .digest();
}

export function issueRecoveryCode(input: {
  pepper: Uint8Array;
  keyVersion: number;
}): IssuedRecoveryCode {
  if (input.pepper.byteLength < 32) {
    throw new Error("Recovery pepper must contain at least 256 bits");
  }

  const selector = randomBytes(SELECTOR_BYTES).toString("base64url");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");

  return {
    displayCode: `${CODE_VERSION}_${selector}.${secret}`,
    persisted: {
      selector,
      digest: digest(selector, secret, input.pepper),
      keyVersion: input.keyVersion,
      consumedAt: null,
    },
  };
}

function parse(candidate: string): { selector: string; secret: string } | null {
  const match = /^wl1_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(candidate);
  if (!match) return null;

  const [, selector, secret] = match;
  if (
    selector.length !== 22 ||
    secret.length !== 43 ||
    !BASE64URL.test(selector) ||
    !BASE64URL.test(secret) ||
    Buffer.from(selector, "base64url").byteLength !== SELECTOR_BYTES ||
    Buffer.from(secret, "base64url").byteLength !== SECRET_BYTES
  ) {
    return null;
  }

  return { selector, secret };
}

export function verifyRecoveryCode(input: {
  candidate: string;
  persisted: PersistedRecoveryCode;
  pepper: Uint8Array;
}): boolean {
  const parsed = parse(input.candidate);
  if (!parsed || parsed.selector !== input.persisted.selector) return false;

  const expected = Buffer.from(input.persisted.digest);
  const actual = digest(parsed.selector, parsed.secret, input.pepper);
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

/**
 * An in-memory demonstration of the state transition only. Production must use
 * one conditional PostgreSQL UPDATE so two processes cannot both consume it.
 */
export class RecoveryCodeStore {
  readonly #record: PersistedRecoveryCode;

  constructor(record: PersistedRecoveryCode) {
    this.#record = record;
  }

  consume(candidate: string, pepper: Uint8Array, now = new Date()): boolean {
    if (this.#record.consumedAt !== null) return false;
    if (!verifyRecoveryCode({ candidate, persisted: this.#record, pepper })) {
      return false;
    }
    this.#record.consumedAt = now;
    return true;
  }

  snapshot(): PersistedRecoveryCode {
    return {
      ...this.#record,
      digest: Uint8Array.from(this.#record.digest),
    };
  }
}
