import "server-only";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

type RecoveryPepperSet = Map<number, Buffer>;

function readPepperSet(): RecoveryPepperSet {
  const serialized = process.env.RECOVERY_CODE_PEPPERS;
  if (!serialized) {
    throw new Error("RECOVERY_CODE_PEPPERS is required for recovery operations");
  }

  let values: unknown;
  try {
    values = JSON.parse(serialized);
  } catch {
    throw new Error("RECOVERY_CODE_PEPPERS must be a JSON object");
  }

  if (!values || Array.isArray(values) || typeof values !== "object") {
    throw new Error("RECOVERY_CODE_PEPPERS must be a JSON object");
  }

  const peppers: RecoveryPepperSet = new Map();
  for (const [rawVersion, encoded] of Object.entries(values)) {
    const version = Number(rawVersion);
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      typeof encoded !== "string" ||
      !BASE64URL.test(encoded)
    ) {
      throw new Error("RECOVERY_CODE_PEPPERS contains an invalid entry");
    }

    const pepper = Buffer.from(encoded, "base64url");
    if (pepper.byteLength < 32) {
      throw new Error("Each recovery pepper must contain at least 256 bits");
    }
    peppers.set(version, pepper);
  }

  if (peppers.size === 0) {
    throw new Error("RECOVERY_CODE_PEPPERS must contain at least one key");
  }

  return peppers;
}

export function getRecoveryPepper(version: number): Buffer {
  const pepper = readPepperSet().get(version);
  if (!pepper) {
    throw new Error(`Recovery pepper key version ${version} is unavailable`);
  }
  return pepper;
}

export function getActiveRecoveryPepper(): {
  version: number;
  pepper: Buffer;
} {
  const version = Number(process.env.RECOVERY_CODE_ACTIVE_PEPPER_VERSION);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(
      "RECOVERY_CODE_ACTIVE_PEPPER_VERSION must be a positive integer",
    );
  }

  return { version, pepper: getRecoveryPepper(version) };
}
