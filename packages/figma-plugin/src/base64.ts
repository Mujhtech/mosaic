/**
 * Base64 for the Figma plugin sandbox.
 *
 * The sandbox is not Node and not quite a browser: there is no `Buffer`, and
 * `btoa` is not part of the plugin API surface. `exportAsync` hands back a
 * `Uint8Array`, and the export bundle needs it as text, so the encoder is
 * written out by hand.
 *
 * Bytes are consumed in groups of three and emitted as four characters, with
 * the tail padded per RFC 4648. The chunking exists so a multi-megabyte PNG
 * does not build one enormous intermediate array.
 */

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Bytes per pass. A multiple of 3 so no group is ever split across passes. */
const CHUNK_BYTES = 3 * 1024;

export function toBase64(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const end = Math.min(offset + CHUNK_BYTES, bytes.length);
    let chunk = "";
    let index = offset;
    for (; index + 2 < end; index += 3) {
      const triple =
        ((bytes[index] as number) << 16) |
        ((bytes[index + 1] as number) << 8) |
        (bytes[index + 2] as number);
      chunk +=
        (ALPHABET[(triple >> 18) & 63] as string) +
        (ALPHABET[(triple >> 12) & 63] as string) +
        (ALPHABET[(triple >> 6) & 63] as string) +
        (ALPHABET[triple & 63] as string);
    }
    // The remainder is only ever one or two bytes, and only on the final pass
    // because CHUNK_BYTES is a multiple of three.
    const remaining = end - index;
    if (remaining === 1) {
      const single = bytes[index] as number;
      chunk +=
        (ALPHABET[single >> 2] as string) +
        (ALPHABET[(single << 4) & 63] as string) +
        "==";
    } else if (remaining === 2) {
      const pair = ((bytes[index] as number) << 8) | (bytes[index + 1] as number);
      chunk +=
        (ALPHABET[pair >> 10] as string) +
        (ALPHABET[(pair >> 4) & 63] as string) +
        (ALPHABET[(pair << 2) & 63] as string) +
        "=";
    }
    output += chunk;
  }
  return output;
}
