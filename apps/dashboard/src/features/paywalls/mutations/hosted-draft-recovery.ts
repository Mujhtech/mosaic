import type { MosaicDocument } from "@/features/paywall-editor/types/editor";

const HOSTED_DRAFT_RECOVERY_PREFIX = "mosaic.hosted-draft-recovery.v1:";
const HOSTED_DRAFT_RECOVERY_VERSION = 1;
const MAX_RECOVERY_BYTES = 1_100_000;
const RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface HostedDraftRecoveryScope {
  readonly draftId: string;
  readonly environmentId: string;
  readonly paywallId: string;
  readonly projectId: string;
}

export interface HostedDraftRecoveryRecord extends HostedDraftRecoveryScope {
  readonly document: MosaicDocument;
  readonly expectedRevision: number;
  readonly reason: "conflict" | "offline" | "unsaved";
  readonly savedAt: string;
  readonly version: 1;
}

function recoveryKey(scope: HostedDraftRecoveryScope) {
  return `${HOSTED_DRAFT_RECOVERY_PREFIX}${encodeURIComponent(scope.projectId)}:${encodeURIComponent(scope.environmentId)}:${encodeURIComponent(scope.paywallId)}:${encodeURIComponent(scope.draftId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecoveryRecord(value: unknown): value is HostedDraftRecoveryRecord {
  if (!isRecord(value) || value.version !== HOSTED_DRAFT_RECOVERY_VERSION) {
    return false;
  }
  return (
    typeof value.draftId === "string" &&
    typeof value.environmentId === "string" &&
    typeof value.paywallId === "string" &&
    typeof value.projectId === "string" &&
    typeof value.expectedRevision === "number" &&
    Number.isInteger(value.expectedRevision) &&
    typeof value.savedAt === "string" &&
    (value.reason === "conflict" ||
      value.reason === "offline" ||
      value.reason === "unsaved") &&
    isRecord(value.document)
  );
}

function isExpired(record: HostedDraftRecoveryRecord, now = Date.now()) {
  const savedAt = Date.parse(record.savedAt);
  return !Number.isFinite(savedAt) || now - savedAt > RECOVERY_TTL_MS;
}

export function writeHostedDraftRecovery(
  scope: HostedDraftRecoveryScope,
  input: {
    document: MosaicDocument;
    expectedRevision: number;
    reason: HostedDraftRecoveryRecord["reason"];
  }
) {
  if (typeof window === "undefined") {
    return false;
  }
  const record: HostedDraftRecoveryRecord = {
    ...scope,
    document: input.document,
    expectedRevision: input.expectedRevision,
    reason: input.reason,
    savedAt: new Date().toISOString(),
    version: HOSTED_DRAFT_RECOVERY_VERSION,
  };
  try {
    const serialized = JSON.stringify(record);
    if (new Blob([serialized]).size > MAX_RECOVERY_BYTES) {
      return false;
    }
    window.localStorage.setItem(recoveryKey(scope), serialized);
    return true;
  } catch {
    return false;
  }
}

export function readHostedDraftRecovery(
  scope: HostedDraftRecoveryScope
): HostedDraftRecoveryRecord | null {
  if (typeof window === "undefined") {
    return null;
  }
  const key = recoveryKey(scope);
  try {
    const serialized = window.localStorage.getItem(key);
    if (!serialized) {
      return null;
    }
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecoveryRecord(parsed) || isExpired(parsed)) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function listHostedDraftRecoveries(input: {
  environmentId: string;
  paywallId?: string;
  projectId: string;
}) {
  if (typeof window === "undefined") {
    return [];
  }
  const recoveries: HostedDraftRecoveryRecord[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(HOSTED_DRAFT_RECOVERY_PREFIX)) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(
        window.localStorage.getItem(key) ?? "null"
      );
      if (!isRecoveryRecord(parsed) || isExpired(parsed)) {
        window.localStorage.removeItem(key);
        continue;
      }
      if (
        parsed.projectId === input.projectId &&
        parsed.environmentId === input.environmentId &&
        (!input.paywallId || parsed.paywallId === input.paywallId)
      ) {
        recoveries.push(parsed);
      }
    } catch {
      // Preserve unrelated local data and ignore malformed Mosaic recovery entries.
    }
  }
  return recoveries.toSorted((left, right) =>
    right.savedAt.localeCompare(left.savedAt)
  );
}

export function clearHostedDraftRecovery(scope: HostedDraftRecoveryScope) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(recoveryKey(scope));
}

export function serializeHostedRecoveryDocument(
  record: HostedDraftRecoveryRecord
) {
  return `${JSON.stringify(record.document, null, 2)}\n`;
}
