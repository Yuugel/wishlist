import "server-only";

export type WebAuthnConfig = {
  rpID: string;
  rpName: string;
  origin: string;
};

type WebAuthnEnvironment = Readonly<{
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  WEBAUTHN_ORIGIN?: string;
  WEBAUTHN_PREVIEW_ENABLED?: string;
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_RP_NAME?: string;
}>;

let cachedConfig: WebAuthnConfig | undefined;

function parseOrigin(value: string, production: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("WEBAUTHN_ORIGIN must be an absolute URL");
  }

  const developmentLocalhost =
    !production && url.protocol === "http:" && url.hostname === "localhost";
  if (
    url.origin !== value ||
    (url.protocol !== "https:" && !developmentLocalhost) ||
    (production && url.hostname === "localhost")
  ) {
    throw new Error(
      "WEBAUTHN_ORIGIN must be an exact HTTPS origin (http://localhost is allowed only in development)",
    );
  }

  return url;
}

/**
 * Resolve only explicit production settings. In particular, never derive a
 * relying party from request headers or a provider-generated deployment URL.
 */
export function resolveWebAuthnConfig(
  environment: WebAuthnEnvironment,
): WebAuthnConfig {
  const production = environment.NODE_ENV === "production";

  if (
    production &&
    environment.VERCEL_ENV === "preview" &&
    environment.WEBAUTHN_PREVIEW_ENABLED !== "true"
  ) {
    throw new Error(
      "WebAuthn is disabled for Vercel Preview deployments unless WEBAUTHN_PREVIEW_ENABLED=true is set explicitly",
    );
  }

  const originValue = environment.WEBAUTHN_ORIGIN ??
    (production ? undefined : "http://localhost:3000");
  const rpID = environment.WEBAUTHN_RP_ID ??
    (production ? undefined : "localhost");
  const rpName = environment.WEBAUTHN_RP_NAME?.trim() || "Wishlist";

  if (!originValue || !rpID) {
    throw new Error(
      "WEBAUTHN_ORIGIN and WEBAUTHN_RP_ID are required in production",
    );
  }

  const origin = parseOrigin(originValue, production);
  if (
    rpID.includes(":") ||
    rpID.includes("/") ||
    rpID !== rpID.toLowerCase() ||
    (production && rpID === "localhost") ||
    (origin.hostname !== rpID && !origin.hostname.endsWith(`.${rpID}`))
  ) {
    throw new Error("WEBAUTHN_RP_ID must be a valid registrable suffix of the origin hostname");
  }

  return { rpID, rpName, origin: origin.origin };
}

export function getWebAuthnConfig(): WebAuthnConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = resolveWebAuthnConfig(process.env);
  return cachedConfig;
}
