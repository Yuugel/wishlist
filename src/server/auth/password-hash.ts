import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const PASSWORD_SCRYPT_PARAMETERS = {
  algorithm: "scrypt",
  cost: 32_768,
  blockSize: 8,
  parallelization: 3,
  keyLength: 32,
  saltLength: 16,
} as const;

const MAX_SCRYPT_MEMORY_BYTES = 128 * 1024 * 1024;
const SCRYPT_OVERHEAD_BYTES = 8 * 1024 * 1024;
const DUMMY_SALT = Buffer.alloc(PASSWORD_SCRYPT_PARAMETERS.saltLength, 0xa5);
const DUMMY_DERIVED_KEY = Buffer.alloc(PASSWORD_SCRYPT_PARAMETERS.keyLength, 0x5a);

export type PasswordCredentialData = {
  algorithm: string;
  salt: Buffer;
  derivedKey: Buffer;
  cost: number;
  blockSize: number;
  parallelization: number;
  keyLength: number;
};

function derive(
  password: string,
  salt: Buffer,
  parameters: Pick<
    PasswordCredentialData,
    "cost" | "blockSize" | "parallelization" | "keyLength"
  >,
): Promise<Buffer> {
  const memory = 128 * parameters.cost * parameters.blockSize;
  const maxmem = memory + SCRYPT_OVERHEAD_BYTES;
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      parameters.keyLength,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem,
      },
      (error, result) => error ? reject(error) : resolve(result),
    );
  });
}

function safeParameters(
  credential: PasswordCredentialData,
): credential is PasswordCredentialData {
  const memory = 128 * credential.cost * credential.blockSize;
  return credential.algorithm === PASSWORD_SCRYPT_PARAMETERS.algorithm &&
    credential.salt.byteLength >= 16 &&
    credential.salt.byteLength <= 64 &&
    credential.derivedKey.byteLength === credential.keyLength &&
    credential.keyLength >= 16 &&
    credential.keyLength <= 64 &&
    credential.cost >= 16_384 &&
    credential.cost <= 1_048_576 &&
    (credential.cost & (credential.cost - 1)) === 0 &&
    credential.blockSize > 0 &&
    credential.blockSize <= 32 &&
    credential.parallelization > 0 &&
    credential.parallelization <= 16 &&
    Number.isSafeInteger(memory) &&
    memory + SCRYPT_OVERHEAD_BYTES <= MAX_SCRYPT_MEMORY_BYTES;
}

export async function hashPassword(
  password: string,
): Promise<PasswordCredentialData> {
  const salt = randomBytes(PASSWORD_SCRYPT_PARAMETERS.saltLength);
  const parameters = PASSWORD_SCRYPT_PARAMETERS;
  const derivedKey = await derive(password, salt, parameters);
  return {
    algorithm: parameters.algorithm,
    salt,
    derivedKey,
    cost: parameters.cost,
    blockSize: parameters.blockSize,
    parallelization: parameters.parallelization,
    keyLength: parameters.keyLength,
  };
}

/** Always performs scrypt, including for unknown accounts and invalid rows. */
export async function verifyPassword(
  password: string,
  credential: PasswordCredentialData | null,
): Promise<boolean> {
  const usable = credential !== null && safeParameters(credential);
  const selected = usable
    ? credential
    : {
        ...PASSWORD_SCRYPT_PARAMETERS,
        salt: DUMMY_SALT,
        derivedKey: DUMMY_DERIVED_KEY,
      };
  const candidate = await derive(password, selected.salt, selected);
  const matches = candidate.byteLength === selected.derivedKey.byteLength &&
    timingSafeEqual(candidate, selected.derivedKey);
  return usable && matches;
}
