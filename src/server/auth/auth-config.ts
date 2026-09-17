import "server-only";

export type WebAuthnConfig = {
  rpID: string;
  rpName: string;
  origin: string;
};

let cachedConfig: WebAuthnConfig | undefined;

function parseOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("WEBAUTHN_ORIGIN must be an absolute URL");
  }

  if (url.origin !== value || (url.protocol !== "https:" && url.hostname !== "localhost")) {
    throw new Error(
      "WEBAUTHN_ORIGIN must be an HTTPS origin (http://localhost is allowed for development)",
    );
  }

  return url;
}

export function getWebAuthnConfig(): WebAuthnConfig {
  if (cachedConfig) return cachedConfig;

  const production = process.env.NODE_ENV === "production";
  const originValue = process.env.WEBAUTHN_ORIGIN ??
    (production ? undefined : "http://localhost:3000");
  const rpID = process.env.WEBAUTHN_RP_ID ??
    (production ? undefined : "localhost");
  const rpName = process.env.WEBAUTHN_RP_NAME?.trim() || "Wishlist";

  if (!originValue || !rpID) {
    throw new Error(
      "WEBAUTHN_ORIGIN and WEBAUTHN_RP_ID are required in production",
    );
  }

  const origin = parseOrigin(originValue);
  if (
    rpID.includes(":") ||
    rpID.includes("/") ||
    rpID !== rpID.toLowerCase() ||
    (origin.hostname !== rpID && !origin.hostname.endsWith(`.${rpID}`))
  ) {
    throw new Error("WEBAUTHN_RP_ID must be a valid registrable suffix of the origin hostname");
  }

  cachedConfig = { rpID, rpName, origin: origin.origin };
  return cachedConfig;
}
