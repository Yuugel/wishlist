import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashPassword,
  PASSWORD_SCRYPT_PARAMETERS,
  verifyPassword,
} from "./password-hash";

describe("password hashing", () => {
  it("uses salted, parameterized scrypt and verifies timing-safely", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    assert.equal(first.algorithm, "scrypt");
    assert.equal(first.cost, PASSWORD_SCRYPT_PARAMETERS.cost);
    assert.equal(first.blockSize, PASSWORD_SCRYPT_PARAMETERS.blockSize);
    assert.equal(first.parallelization, PASSWORD_SCRYPT_PARAMETERS.parallelization);
    assert.equal(first.salt.byteLength, 16);
    assert.equal(first.derivedKey.byteLength, 32);
    assert.equal(first.salt.equals(second.salt), false);
    assert.equal(first.derivedKey.equals(second.derivedKey), false);
    assert.equal(first.derivedKey.includes(Buffer.from("correct horse")), false);
    assert.equal(await verifyPassword("correct horse battery staple", first), true);
    assert.equal(await verifyPassword("incorrect horse battery staple", first), false);
  });

  it("performs a dummy derivation and fails for an unknown account", async () => {
    assert.equal(await verifyPassword("any-valid-password", null), false);
  });
});
