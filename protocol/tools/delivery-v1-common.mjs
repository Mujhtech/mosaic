import { createHash } from "node:crypto";

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortCanonical(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(sortCanonical(value));
}

export function sha256Digest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function releaseMaterialDigest(envelope) {
  const material = structuredClone(envelope.release);
  delete material.contentDigest;
  return sha256Digest(material);
}
