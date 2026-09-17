import "server-only";

import { randomBytes } from "node:crypto";
import { AuthError, authenticationFailed } from "./auth-error";
import {
  hashPassword,
  verifyPassword,
  type PasswordCredentialData,
} from "./password-hash";
import {
  parseNewPassword,
  parsePasswordLogin,
  parsePasswordSignup,
} from "./password-input";
import { isFreshAuthentication } from "./passkey-policy";
import {
  DrizzlePasswordRepository,
  EmailAlreadyExistsError,
  type PasswordRepository,
  type PreparedPasswordRecoveryCode,
} from "./password-repository";
import { prepareRecoveryCode } from "./recovery-service";
import type { ResolvedSession } from "./session-service";

type PasswordOperations = {
  hash(password: string): Promise<PasswordCredentialData>;
  verify(password: string, credential: PasswordCredentialData | null): Promise<boolean>;
};

const defaultPasswordOperations: PasswordOperations = {
  hash: hashPassword,
  verify: verifyPassword,
};

export class PasswordAuthService {
  constructor(
    private readonly repository: PasswordRepository,
    private readonly passwords: PasswordOperations = defaultPasswordOperations,
    private readonly recoveryCode: () => PreparedPasswordRecoveryCode = prepareRecoveryCode,
  ) {}

  async signup(value: unknown, now = new Date()): Promise<{
    userId: string;
    recoveryCode: string;
  }> {
    const input = parsePasswordSignup(value);
    const [credential, recoveryCode] = await Promise.all([
      this.passwords.hash(input.password),
      Promise.resolve().then(() => this.recoveryCode()),
    ]);

    try {
      const userId = await this.repository.createAccount({
        displayName: input.displayName,
        email: input.email,
        emailNormalized: input.emailNormalized,
        webauthnUserHandle: randomBytes(32),
        credential,
        recoveryCode,
        now,
      });
      return { userId, recoveryCode: recoveryCode.displayCode };
    } catch (error) {
      if (error instanceof EmailAlreadyExistsError) {
        throw new AuthError(
          "email_already_exists",
          409,
          "Für diese E-Mail-Adresse besteht bereits ein Konto. Bitte melde dich an.",
        );
      }
      throw error;
    }
  }

  async login(value: unknown): Promise<{ userId: string }> {
    const input = parsePasswordLogin(value);
    const account = await this.repository.findByNormalizedEmail(
      input.emailNormalized,
    );
    const valid = await this.passwords.verify(
      input.password,
      account?.credential ?? null,
    );
    if (!valid || account?.status !== "active") {
      throw authenticationFailed("E-Mail oder Passwort ist nicht korrekt.");
    }
    return { userId: account.userId };
  }

  async addPassword(
    session: ResolvedSession,
    value: unknown,
    now = new Date(),
  ): Promise<void> {
    if (!isFreshAuthentication(session.createdAt, now)) {
      throw new AuthError(
        "reauthentication_required",
        403,
        "Bitte melde dich erneut an, bevor du ein Passwort hinzufügst.",
      );
    }
    const password = parseNewPassword(value);
    const credential = await this.passwords.hash(password);
    const result = await this.repository.addPassword(
      session.userId,
      credential,
      now,
    );
    if (result === "added") return;
    if (result === "email_required") {
      throw new AuthError(
        "email_required",
        409,
        "Für dieses Konto muss zuerst eine E-Mail-Adresse hinterlegt sein.",
      );
    }
    if (result === "already_exists") {
      throw new AuthError(
        "password_already_exists",
        409,
        "Für dieses Konto ist bereits ein Passwort eingerichtet.",
      );
    }
    throw authenticationFailed("Das Konto ist nicht verfügbar.");
  }
}

const passwordService = new PasswordAuthService(
  new DrizzlePasswordRepository(),
);

export function signupWithPassword(value: unknown, now?: Date) {
  return passwordService.signup(value, now);
}

export function loginWithPassword(value: unknown) {
  return passwordService.login(value);
}

export function addPasswordToAccount(
  session: ResolvedSession,
  value: unknown,
  now?: Date,
) {
  return passwordService.addPassword(session, value, now);
}
