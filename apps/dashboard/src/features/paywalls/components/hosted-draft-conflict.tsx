import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { WarningDiamondIcon } from "@phosphor-icons/react/dist/ssr/WarningDiamond";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { HostedAutosaveConflict } from "@/features/paywalls/hooks/use-hosted-draft-autosave";
import type { HostedDraft } from "@/features/publishing/api/hosted-publishing-adapter";

function changedSections(
  conflict: HostedAutosaveConflict,
  latest: HostedDraft
) {
  const local = conflict.localDocument as unknown as Record<string, unknown>;
  const server = latest.document as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(local), ...Object.keys(server)])].filter(
    (key) => JSON.stringify(local[key]) !== JSON.stringify(server[key])
  );
}

export function HostedDraftConflict({
  conflict,
  onExportLocal,
  onInspectLatest,
  onReconcile,
  onReloadLatest,
}: {
  conflict: HostedAutosaveConflict;
  onExportLocal: () => void;
  onInspectLatest: () => Promise<HostedDraft>;
  onReconcile: (latest: HostedDraft) => void;
  onReloadLatest: (latest: HostedDraft) => void;
}) {
  const [latest, setLatest] = useState<HostedDraft | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  async function inspectLatest() {
    setIsInspecting(true);
    setInspectError(null);
    try {
      setLatest(await onInspectLatest());
    } catch (error) {
      setInspectError(
        error instanceof Error
          ? error.message
          : "The hosted Draft could not load."
      );
    } finally {
      setIsInspecting(false);
    }
  }

  const sections = latest ? changedSections(conflict, latest) : [];

  return (
    <section
      aria-labelledby="hosted-draft-conflict-title"
      className="rounded border border-destructive/30 bg-destructive/5 p-4"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <WarningDiamondIcon
          aria-hidden
          className="mt-0.5 shrink-0 text-destructive"
          size={20}
        />
        <div className="min-w-0 flex-1">
          <h2
            className="font-semibold text-sm"
            id="hosted-draft-conflict-title"
          >
            A newer hosted Draft is available
          </h2>
          <p className="mt-1 text-muted-foreground text-sm leading-6">
            Your local edits remain open and have not overwritten revision{" "}
            {conflict.latestRevision}. Autosave is paused while you preserve or
            review this work.
          </p>
          <p className="mt-2 text-muted-foreground text-xs">
            This editor expected revision {conflict.expectedRevision}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={onExportLocal}
              size="sm"
              type="button"
              variant="outline"
            >
              <DownloadSimpleIcon aria-hidden />
              Export recovery copy
            </Button>
            <Button
              disabled={isInspecting}
              onClick={() => {
                inspectLatest();
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <ArrowsLeftRightIcon aria-hidden />
              {isInspecting ? "Loading latest…" : "Review changed sections"}
            </Button>
          </div>
          {inspectError ? (
            <div className="mt-3" role="alert">
              <p className="text-destructive text-sm">{inspectError}</p>
              <Button
                className="mt-2"
                onClick={() => {
                  inspectLatest();
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                <ArrowClockwiseIcon aria-hidden />
                Retry comparison
              </Button>
            </div>
          ) : null}
          {latest ? (
            <div className="mt-4 rounded border border-border bg-background p-3">
              <p className="font-semibold text-sm">
                Latest hosted revision {latest.revision}
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                {sections.length > 0
                  ? `Changed document sections: ${sections.join(", ")}.`
                  : "No top-level document sections differ from your preserved copy."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={() => onReconcile(latest)}
                  size="sm"
                  type="button"
                >
                  Replace latest Draft with my edits
                </Button>
                <Button
                  onClick={() => onReloadLatest(latest)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Reload latest hosted Draft
                </Button>
              </div>
              <p className="mt-2 text-muted-foreground text-xs">
                Replacing saves your entire open document as the next hosted
                revision; this is not a field-by-field merge. Reload preserves
                your current work in browser recovery before replacing the
                canvas.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
