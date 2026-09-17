import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthError } from "./auth-error";
import type { PasswordCredentialData } from "./password-hash";
import {
  EmailAlreadyExistsError,
  type AddPasswordResult,
  type CreatePasswordAccountInput,
  type PasswordAccount,
  type PasswordRepository,
} from "./password-repository";
import { PasswordAuthService } from "./password-service";
import type { ResolvedSession } from "./session-service";

const credential: PasswordCredentialData = {
  algorithm: "scrypt",
  salt: Buffer.alloc(16, 1),
  derivedKey: Buffer.from("correct-password"),
  cost: 32_768,
  blockSize: 8,
  parallelization: 3,
  keyLength: 16,
};

class MemoryPasswordRepository implements PasswordRepository {
  accounts = new Map<string, PasswordAccount>();
  created?: CreatePasswordAccountInput;
  addResult: AddPasswordResult = "added";
  addedCredential?: PasswordCredentialData;

  async findByNormalizedEmail(email: string) {
    return this.accounts.get(email) ?? null;
  }

  async createAccount(input: CreatePasswordAccountInput) {
    if (this.accounts.has(input.emailNormalized)) {
      throw new EmailAlreadyExistsError();
    }
    this.created = input;
    this.accounts.set(input.emailNormalized, {
      userId: "new-user",
      status: "active",
      credential: input.credential,
    });
    return "new-user";
  }

  async addPassword(
    _userId: string,
    addedCredential: PasswordCredentialData,
  ) {
    this.addedCredential = addedCredential;
    return this.addResult;
  }
}

const passwordOperations = {
  async hash(password: string) {
    return { ...credential, derivedKey: Buffer.from(password) };
  },
  async verify(password: string, stored: PasswordCredentialData | null) {
    return stored?.derivedKey.equals(Buffer.from(password)) ?? false;
  },
};

function service(repository: MemoryPasswordRepository) {
  return new PasswordAuthService(repository, passwordOperations, () => ({
    displayCode: "recovery-display-code",
    selector: "selector",
    digest: Buffer.alloc(32, 2),
    pepperKeyVersion: 1,
  }));
}

function session(createdAt = new Date("2026-09-17T12:00:00.000Z")): ResolvedSession {
  return {
    sessionId: "session-id",
    userId: "existing-user",
    createdAt,
    idleExpiresAt: new Date("2026-09-18T12:00:00.000Z"),
    absoluteExpiresAt: new Date("2026-10-17T12:00:00.000Z"),
  };
}

async function authenticationError(operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) =>
    error instanceof AuthError &&
    error.code === "authentication_failed" &&
    error.publicMessage === "E-Mail oder Passwort ist nicht korrekt.",
  );
}

describe("password authentication service", () => {
  it("creates a password account with normalized email and recovery code", async () => {
    const repository = new MemoryPasswordRepository();
    const result = await service(repository).signup({
      displayName: "  Ada  ",
      email: " Ada@Example.COM ",
      password: "a-strong-password",
    });

    assert.deepEqual(result, {
      userId: "new-user",
      recoveryCode: "recovery-display-code",
    });
    assert.equal(repository.created?.displayName, "Ada");
    assert.equal(repository.created?.emailNormalized, "ada@example.com");
    assert.equal(repository.created?.webauthnUserHandle.byteLength, 32);
    assert.equal(repository.created?.credential.derivedKey.toString(), "a-strong-password");
  });

  it("rejects a duplicate normalized email without linking credentials", async () => {
    const repository = new MemoryPasswordRepository();
    repository.accounts.set("ada@example.com", {
      userId: "passkey-user",
      status: "active",
      credential: null,
    });

    await assert.rejects(
      () => service(repository).signup({
        displayName: "Andere Person",
        email: "ADA@example.com",
        password: "another-password",
      }),
      (error: unknown) =>
        error instanceof AuthError && error.code === "email_already_exists",
    );
    assert.equal(repository.created, undefined);
  });

  it("authenticates a valid password", async () => {
    const repository = new MemoryPasswordRepository();
    repository.accounts.set("ada@example.com", {
      userId: "ada-user",
      status: "active",
      credential: { ...credential, derivedKey: Buffer.from("correct-password") },
    });

    assert.deepEqual(
      await service(repository).login({
        email: "ADA@example.com",
        password: "correct-password",
      }),
      { userId: "ada-user" },
    );
  });

  it("uses the same failure for wrong password and unknown email", async () => {
    const repository = new MemoryPasswordRepository();
    repository.accounts.set("ada@example.com", {
      userId: "ada-user",
      status: "active",
      credential,
    });

    await authenticationError(() => service(repository).login({
      email: "ada@example.com",
      password: "wrong-password-value",
    }));
    await authenticationError(() => service(repository).login({
      email: "unknown@example.com",
      password: "wrong-password-value",
    }));
  });

  it("keeps an existing passkey-only account valid but unavailable to password login", async () => {
    const repository = new MemoryPasswordRepository();
    repository.accounts.set("passkey@example.com", {
      userId: "passkey-user",
      status: "active",
      credential: null,
    });

    await authenticationError(() => service(repository).login({
      email: "passkey@example.com",
      password: "some-valid-password",
    }));
  });

  it("adds a password only to a freshly authenticated account", async () => {
    const repository = new MemoryPasswordRepository();
    const now = new Date("2026-09-17T12:05:00.000Z");

    await service(repository).addPassword(session(), {
      password: "new-secure-password",
    }, now);
    assert.equal(
      repository.addedCredential?.derivedKey.toString(),
      "new-secure-password",
    );

    repository.addResult = "already_exists";
    await assert.rejects(
      () => service(repository).addPassword(session(), {
        password: "new-secure-password",
      }, now),
      (error: unknown) =>
        error instanceof AuthError && error.code === "password_already_exists",
    );

    await assert.rejects(
      () => service(repository).addPassword(
        session(new Date("2026-09-17T11:00:00.000Z")),
        { password: "new-secure-password" },
        now,
      ),
      (error: unknown) =>
        error instanceof AuthError && error.code === "reauthentication_required",
    );
  });
});
