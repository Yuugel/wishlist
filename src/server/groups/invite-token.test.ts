import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  digestGroupInviteToken,
  generateGroupInviteToken,
  parseGroupInviteToken,
  verifyGroupInviteToken,
} from "./invite-token";

describe("group invite tokens", () => {
  it("uses a high-entropy selector/secret format and stores only a digest", () => {
    const generated = generateGroupInviteToken();
    const parsed = parseGroupInviteToken(generated.token);

    assert.equal(parsed?.selector, generated.selector);
    assert.equal(parsed?.secret.length, 43);
    assert.equal(generated.digest.byteLength, 32);
    assert.deepEqual(digestGroupInviteToken(generated.token), generated.digest);
    assert.equal(
      verifyGroupInviteToken({
        candidate: generated.token,
        selector: generated.selector,
        persistedDigest: generated.digest,
      }),
      true,
    );
    assert.notDeepEqual(generated.digest, Buffer.from(parsed!.secret));
  });

  it("rejects malformed, non-canonical, modified, and wrong-selector tokens", () => {
    const generated = generateGroupInviteToken();
    const modified = `${generated.token.slice(0, -1)}${
      generated.token.endsWith("A") ? "B" : "A"
    }`;
    const parsed = parseGroupInviteToken(generated.token)!;
    const nonCanonical = `wgi1_${parsed.selector}=.${parsed.secret}`;

    assert.equal(parseGroupInviteToken("not-an-invite"), null);
    assert.equal(parseGroupInviteToken(nonCanonical), null);
    assert.notDeepEqual(
      digestGroupInviteToken(modified),
      digestGroupInviteToken(generated.token),
    );
    assert.equal(
      verifyGroupInviteToken({
        candidate: modified,
        selector: generated.selector,
        persistedDigest: generated.digest,
      }),
      false,
    );
    assert.equal(
      verifyGroupInviteToken({
        candidate: generated.token,
        selector: "invalid-selector",
        persistedDigest: generated.digest,
      }),
      false,
    );
  });
});
