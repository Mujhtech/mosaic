import { beforeEach, describe, expect, it } from "vitest";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import {
  readHostedDraftRecovery,
  serializeHostedRecoveryDocument,
  writeHostedDraftRecovery,
} from "@/features/paywalls/mutations/hosted-draft-recovery";
import { required } from "@/test/required";

describe("hosted Draft browser recovery", () => {
  beforeEach(() => window.localStorage.clear());

  it("preserves and exports conflicting edits without requiring a valid protocol document", () => {
    const scope = {
      draftId: "draft_01",
      environmentId: "env_staging",
      paywallId: "paywall_01",
      projectId: "project_01",
    };
    const unfinishedDocument = {
      id: "unfinished-paywall",
      revision: 9,
      schemaVersion: "0.3",
    } as MosaicDocument;

    expect(
      writeHostedDraftRecovery(scope, {
        document: unfinishedDocument,
        expectedRevision: 7,
        reason: "conflict",
      })
    ).toBe(true);

    const recovered = readHostedDraftRecovery(scope);
    expect(recovered).toMatchObject({
      document: unfinishedDocument,
      expectedRevision: 7,
      reason: "conflict",
    });
    expect(
      serializeHostedRecoveryDocument(required(recovered, "recovered"))
    ).toContain('"id": "unfinished-paywall"');
  });
});
