import { describe, expect, it } from "vitest";
import { toBase64 } from "./base64.js";

/** The reference the plugin cannot use: `Buffer` does not exist in the sandbox. */
function reference(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("base64 without Buffer", () => {
  it("encodes the RFC 4648 examples", () => {
    const encode = (value: string) =>
      toBase64(Uint8Array.from([...value].map((char) => char.charCodeAt(0))));
    expect(encode("")).toBe("");
    expect(encode("f")).toBe("Zg==");
    expect(encode("fo")).toBe("Zm8=");
    expect(encode("foo")).toBe("Zm9v");
    expect(encode("foob")).toBe("Zm9vYg==");
    expect(encode("fooba")).toBe("Zm9vYmE=");
    expect(encode("foobar")).toBe("Zm9vYmFy");
  });

  it("agrees with Buffer on every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_value, index) => index);
    expect(toBase64(bytes)).toBe(reference(bytes));
  });

  it("agrees with Buffer at every remainder around the chunk boundary", () => {
    // CHUNK_BYTES is a multiple of three, so only the final pass can have a
    // remainder; these lengths straddle the boundary in both directions.
    for (const length of [3071, 3072, 3073, 6143, 6144, 6145]) {
      const bytes = Uint8Array.from({ length }, (_value, index) => (index * 7) % 256);
      expect(toBase64(bytes)).toBe(reference(bytes));
    }
  });

  it("never emits a high-bit character for a high-bit byte", () => {
    const bytes = Uint8Array.from({ length: 64 }, () => 0xff);
    expect(toBase64(bytes)).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(toBase64(bytes)).toBe(reference(bytes));
  });
});
