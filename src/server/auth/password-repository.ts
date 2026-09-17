import "server-only";

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  passwordCredentials,
  recoveryCodes,
  users,
} from "../db/schema";
import type { PasswordCredentialData } from "./password-hash";

export type PasswordAccount = {
  userId: string;
  status: "active" | "disabled";
  credential: PasswordCredentialData | null;
};

export type PreparedPasswordRecoveryCode = {
  displayCode: string;
  selector: string;
  digest: Buffer;
  pepperKeyVersion: number;
};

export type CreatePasswordAccountInput = {
  displayName: string;
  email: string;
  emailNormalized: string;
  webauthnUserHandle: Buffer;
  credential: PasswordCredentialData;
  recoveryCode: PreparedPasswordRecoveryCode;
  now: Date;
};

export type AddPasswordResult =
  | "added"
  | "already_exists"
  | "email_required"
  | "inactive";

export interface PasswordRepository {
  findByNormalizedEmail(emailNormalized: string): Promise<PasswordAccount | null>;
  createAccount(input: CreatePasswordAccountInput): Promise<string>;
  addPassword(
    userId: string,
    credential: PasswordCredentialData,
    now: Date,
  ): Promise<AddPasswordResult>;
}

export class EmailAlreadyExistsError extends Error {
  constructor() {
    super("email_already_exists");
    this.name = "EmailAlreadyExistsError";
  }
}

function isEmailUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; constraint?: unknown; cause?: unknown };
  if (
    candidate.code === "23505" &&
    candidate.constraint === "users_email_normalized_unique"
  ) return true;
  return candidate.cause !== error && isEmailUniqueViolation(candidate.cause);
}

export class DrizzlePasswordRepository implements PasswordRepository {
  async findByNormalizedEmail(
    emailNormalized: string,
  ): Promise<PasswordAccount | null> {
    const [account] = await db
      .select({
        userId: users.id,
        status: users.status,
        algorithm: passwordCredentials.algorithm,
        salt: passwordCredentials.salt,
        derivedKey: passwordCredentials.derivedKey,
        cost: passwordCredentials.cost,
        blockSize: passwordCredentials.blockSize,
        parallelization: passwordCredentials.parallelization,
        keyLength: passwordCredentials.keyLength,
      })
      .from(users)
      .leftJoin(
        passwordCredentials,
        eq(passwordCredentials.userId, users.id),
      )
      .where(eq(users.emailNormalized, emailNormalized))
      .limit(1);

    if (!account) return null;
    return {
      userId: account.userId,
      status: account.status,
      credential: account.algorithm &&
          account.salt &&
          account.derivedKey &&
          account.cost &&
          account.blockSize &&
          account.parallelization &&
          account.keyLength
        ? {
            algorithm: account.algorithm,
            salt: account.salt,
            derivedKey: account.derivedKey,
            cost: account.cost,
            blockSize: account.blockSize,
            parallelization: account.parallelization,
            keyLength: account.keyLength,
          }
        : null,
    };
  }

  async createAccount(input: CreatePasswordAccountInput): Promise<string> {
    try {
      return await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            webauthnUserHandle: input.webauthnUserHandle,
            displayName: input.displayName,
            email: input.email,
            emailNormalized: input.emailNormalized,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning({ id: users.id });
        if (!user) throw new Error("Account creation failed");

        await tx.insert(passwordCredentials).values({
          userId: user.id,
          ...input.credential,
          createdAt: input.now,
          updatedAt: input.now,
        });
        await tx.insert(recoveryCodes).values({
          userId: user.id,
          selector: input.recoveryCode.selector,
          digest: input.recoveryCode.digest,
          pepperKeyVersion: input.recoveryCode.pepperKeyVersion,
          status: "active",
          createdAt: input.now,
          updatedAt: input.now,
        });
        return user.id;
      });
    } catch (error) {
      if (isEmailUniqueViolation(error)) throw new EmailAlreadyExistsError();
      throw error;
    }
  }

  async addPassword(
    userId: string,
    credential: PasswordCredentialData,
    now: Date,
  ): Promise<AddPasswordResult> {
    return db.transaction(async (tx) => {
      const [account] = await tx
        .select({
          status: users.status,
          emailNormalized: users.emailNormalized,
          passwordUserId: passwordCredentials.userId,
        })
        .from(users)
        .leftJoin(
          passwordCredentials,
          eq(passwordCredentials.userId, users.id),
        )
        .where(eq(users.id, userId))
        .limit(1);
      if (!account || account.status !== "active") return "inactive";
      if (!account.emailNormalized) return "email_required";
      if (account.passwordUserId) return "already_exists";

      const [inserted] = await tx
        .insert(passwordCredentials)
        .values({
          userId,
          ...credential,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: passwordCredentials.userId })
        .returning({ userId: passwordCredentials.userId });
      return inserted ? "added" : "already_exists";
    });
  }
}
