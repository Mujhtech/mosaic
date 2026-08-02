import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_DELAY_MS } from "@/features/paywall-editor/constants/editor-constants";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import { useHostedDraftAutosave } from "@/features/paywalls/hooks/use-hosted-draft-autosave";
import { HostedDraftConflictError } from "@/features/publishing/api/hosted-publishing-adapter";
import { required } from "@/test/required";

function editedDocument(headline: string, revision: number): MosaicDocument {
  const document = cloneValue(
    required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document
  );
  document.revision = revision;
  const headlineNode = document.screens[0]?.layout.content.children.find(
    (node) => node.id === "headline"
  );
  if (headlineNode?.type !== "text") {
    throw new Error("Expected the headline Text");
  }
  headlineNode.value.default = headline;
  return document;
}

describe("hosted Draft autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("preserves the latest local document and pauses writes after a revision conflict", async () => {
    const initialDocument = editedDocument("Initial", 1);
    const firstEdit = editedDocument("My local edit", 2);
    const editAfterConflict = editedDocument("My preserved follow-up", 3);
    const saveDraft = vi
      .fn()
      .mockRejectedValue(
        new HostedDraftConflictError(7, "2026-07-22T12:00:00Z")
      );

    const { result, rerender } = renderHook(
      ({ document }) =>
        useHostedDraftAutosave({
          document,
          draftId: "draft_01",
          enabled: true,
          initialDocument,
          initialRevision: 4,
          saveDraft,
        }),
      { initialProps: { document: initialDocument } }
    );

    rerender({ document: firstEdit });
    expect(result.current.status).toBe("unsaved");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });

    expect(saveDraft).toHaveBeenCalledWith({
      document: firstEdit,
      draftId: "draft_01",
      expectedRevision: 4,
    });
    expect(result.current.status).toBe("conflict");
    expect(result.current.conflict).toMatchObject({
      expectedRevision: 4,
      latestRevision: 7,
      localDocument: firstEdit,
    });

    rerender({ document: editAfterConflict });
    act(() => result.current.retry());

    expect(saveDraft).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("conflict");
    expect(result.current.conflict?.localDocument).toEqual(editAfterConflict);
  });

  it("reconciles preserved edits onto an explicitly inspected latest revision", async () => {
    const initialDocument = editedDocument("Initial", 1);
    const localDocument = editedDocument("My local edit", 2);
    const latestDocument = editedDocument("Teammate edit", 7);
    const saveDraft = vi
      .fn()
      .mockRejectedValueOnce(new HostedDraftConflictError(7))
      .mockResolvedValueOnce({
        document: localDocument,
        environmentId: "env_staging",
        id: "draft_01",
        paywallId: "paywall_01",
        projectId: "project_01",
        revision: 8,
        updatedAt: "2026-07-22T12:10:00Z",
      });
    const { result, rerender } = renderHook(
      ({ document }) =>
        useHostedDraftAutosave({
          document,
          draftId: "draft_01",
          enabled: true,
          initialDocument,
          initialRevision: 4,
          saveDraft,
        }),
      { initialProps: { document: initialDocument } }
    );

    rerender({ document: localDocument });
    await act(async () => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS));
    expect(result.current.status).toBe("conflict");

    await act(async () => {
      result.current.reconcileWithLatest({
        document: latestDocument,
        environmentId: "env_staging",
        id: "draft_01",
        paywallId: "paywall_01",
        projectId: "project_01",
        revision: 7,
        updatedAt: "2026-07-22T12:05:00Z",
      });
      await Promise.resolve();
    });

    expect(saveDraft).toHaveBeenLastCalledWith({
      document: localDocument,
      draftId: "draft_01",
      expectedRevision: 7,
    });
    expect(result.current.status).toBe("saved");
    expect(result.current.conflict).toBeNull();
  });
});
