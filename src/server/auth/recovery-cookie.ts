export const RECOVERY_COOKIE_NAME = "__Host-wishlist-recovery";

export type RecoveryCookie = {
  name: typeof RECOVERY_COOKIE_NAME;
  value: string;
  options: {
    httpOnly: true;
    secure: true;
    sameSite: "strict";
    path: "/";
    expires?: Date;
    maxAge?: number;
  };
};

export function issuedRecoveryCookie(
  claimToken: string,
  expires: Date,
): RecoveryCookie {
  return {
    name: RECOVERY_COOKIE_NAME,
    value: claimToken,
    options: {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      expires,
    },
  };
}

export function clearedRecoveryCookie(): RecoveryCookie {
  return {
    name: RECOVERY_COOKIE_NAME,
    value: "",
    options: {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    },
  };
}
