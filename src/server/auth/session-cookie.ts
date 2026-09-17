export const SESSION_COOKIE_NAME = "__Host-wishlist-session";

export type SessionCookie = {
  name: typeof SESSION_COOKIE_NAME;
  value: string;
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  expires?: Date;
  maxAge?: number;
};

export function issuedSessionCookie(token: string, expires: Date): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires,
  };
}

export function clearedSessionCookie(): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  };
}
