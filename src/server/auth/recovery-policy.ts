export type RecoveryCeremonyContext = {
  type: string;
  userId: string | null;
  recoveryUserId: string;
  recoveryCodeId: string | null;
  claimId: string | null;
  recoveryStatus: string;
  userStatus: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
  maxAttempts: number;
};

export function isRecoveryCeremonyAuthorized(input: {
  ceremony: RecoveryCeremonyContext;
  claimToken: string;
  now: Date;
}): boolean {
  const { ceremony, claimToken, now } = input;
  return (
    ceremony.type === "recovery" &&
    ceremony.userId !== null &&
    ceremony.userId === ceremony.recoveryUserId &&
    ceremony.recoveryCodeId !== null &&
    ceremony.claimId === claimToken &&
    ceremony.recoveryStatus === "claimed" &&
    ceremony.userStatus === "active" &&
    ceremony.consumedAt === null &&
    ceremony.expiresAt.getTime() > now.getTime() &&
    ceremony.attemptCount < ceremony.maxAttempts
  );
}
