import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthError } from "./auth-error";
import { enforceAuthMutationRequest } from "./request-security";

function request(headers: Record<string, string>) {
  return new Request("http://localhost:3000/api/auth/test", {
    method: "POST",
    headers,
  });
}

describe("auth mutation request policy", () => {
  it("accepts same-origin JSON", () => {
    assert.doesNotThrow(() =>
      enforceAuthMutationRequest(
        request({
          Origin: "http://localhost:3000",
          "Content-Type": "application/json; charset=utf-8",
        }),
      ),
    );
  });

  it("rejects a foreign origin and unexpected content type", () => {
    assert.throws(
      () =>
        enforceAuthMutationRequest(
          request({ Origin: "https://attacker.invalid", "Content-Type": "application/json" }),
        ),
      (error: unknown) => error instanceof AuthError && error.status === 403,
    );
    assert.throws(
      () =>
        enforceAuthMutationRequest(
          request({ Origin: "http://localhost:3000", "Content-Type": "text/plain" }),
        ),
      (error: unknown) => error instanceof AuthError && error.status === 400,
    );
  });
});
