import { StatusMessage } from "@mosaic/design-system";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  countTokenReferences,
  type PendingDelete,
  replaceTokenReferences,
  tokensFor,
  withDuplicatedToken,
  withMovedToken,
  withoutToken,
} from "@/features/paywall-editor/components/design-system-controls-support";
import {
  BackgroundTokenSection,
  ColorTokenSection,
  MotionTokenSection,
  ShadowTokenSection,
} from "@/features/paywall-editor/components/design-system-token-sections";
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context";
import type {
  MosaicDocument,
  PaywallDesignSystem,
} from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import {
  documentMotionTokens,
  withDocumentParts,
} from "@/features/paywall-editor/utils/document-version";
import type { DesignCategory } from "@/features/paywall-editor/utils/style-authoring";
import {
  isSafeTokenReplacement,
  tokenReferenceType,
} from "@/features/paywall-editor/utils/style-authoring";

/**
 * "Detach" plus every token that can safely stand in for the one being deleted.
 * Unsafe replacements are omitted rather than disabled: offering a swap that
 * would change what the Draft renders is the mistake this dialog exists to stop.
 */
function tokenReplacementOptions(
  designSystem: PaywallDesignSystem,
  pendingDelete: { category: DesignCategory; id: string }
) {
  return [
    { label: "Detach current values", value: "detach" },
    ...tokensFor(designSystem, pendingDelete.category).flatMap((token) =>
      isSafeTokenReplacement(
        designSystem,
        pendingDelete.category,
        pendingDelete.id,
        token.id
      )
        ? [
            {
              label: `Replace usages with ${token.name}`,
              value: token.id,
            },
          ]
        : []
    ),
  ];
}

export function DesignSystemPanel() {
  const handleClick = useCallback(() => setPendingDelete(null), []);
  const { document } = useEditorStore();
  const editor = useEditorActions();
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null
  );
  const [replacementId, setReplacementId] = useState("detach");
  const [openEditor, setOpenEditor] = useState<PendingDelete | null>(null);

  if (!document) {
    return null;
  }
  const { designSystem } = document;
  const motions = documentMotionTokens(document);

  function updateSystem(
    updater: (current: PaywallDesignSystem) => PaywallDesignSystem
  ) {
    editor.updateDocument((current) =>
      withDocumentParts(current, {
        designSystem: updater(current.designSystem),
      })
    );
  }

  function deleteNow(category: DesignCategory, id: string) {
    updateSystem((current) => withoutToken(current, category, id));
    if (openEditor?.category === category && openEditor.id === id) {
      setOpenEditor(null);
    }
  }

  function requestDelete(category: DesignCategory, id: string) {
    if (
      countTokenReferences(document, tokenReferenceType(category), id) === 0
    ) {
      deleteNow(category, id);
      return;
    }
    setReplacementId("detach");
    setPendingDelete({ category, id });
  }

  function confirmDelete() {
    if (!pendingDelete) {
      return;
    }
    const tokens = tokensFor(designSystem, pendingDelete.category);
    const currentToken = tokens.find((token) => token.id === pendingDelete.id);
    if (!currentToken) {
      return;
    }
    const replacementToken = tokens.find((token) => token.id === replacementId);
    if (
      replacementToken &&
      !isSafeTokenReplacement(
        designSystem,
        pendingDelete.category,
        pendingDelete.id,
        replacementToken.id
      )
    ) {
      setReplacementId("detach");
      return;
    }
    const replacement = replacementToken
      ? {
          type: tokenReferenceType(pendingDelete.category),
          id: replacementToken.id,
        }
      : cloneValue(currentToken.value);
    editor.updateDocument((current) => {
      const replaced = replaceTokenReferences(
        current,
        tokenReferenceType(pendingDelete.category),
        pendingDelete.id,
        replacement
      ) as MosaicDocument;
      return withDocumentParts(replaced, {
        designSystem: withoutToken(
          replaced.designSystem,
          pendingDelete.category,
          pendingDelete.id
        ),
      });
    });
    setPendingDelete(null);
    if (
      openEditor?.category === pendingDelete.category &&
      openEditor.id === pendingDelete.id
    ) {
      setOpenEditor(null);
    }
  }

  function toggleEditor(category: DesignCategory, id: string) {
    setOpenEditor((current) =>
      current?.category === category && current.id === id
        ? null
        : { category, id }
    );
  }

  function move(category: DesignCategory, id: string, offset: -1 | 1) {
    updateSystem((current) => withMovedToken(current, category, id, offset));
  }

  function duplicate(category: DesignCategory, id: string) {
    updateSystem((current) => withDuplicatedToken(current, category, id));
  }

  return (
    <section aria-labelledby="design-system-panel-title" className="space-y-5">
      <div>
        <h2 className="font-semibold text-sm" id="design-system-panel-title">
          Design System
        </h2>
        <p className="mt-0.5 text-muted-foreground text-xs leading-5">
          Reusable paywall colours, backgrounds, and shadows. Linked changes
          update every usage.
        </p>
      </div>

      {pendingDelete ? (
        <StatusMessage
          className="space-y-2 rounded border border-warning/30 bg-warning/5 p-3 text-xs"
          tone="warning"
        >
          <p className="font-medium">This style is in use.</p>
          <div className="grid gap-1">
            <label htmlFor="token-replacement">
              Replace usages or detach their current values
            </label>
            <Select
              items={tokenReplacementOptions(designSystem, pendingDelete)}
              onValueChange={(value) => setReplacementId(value)}
              value={replacementId}
            >
              <SelectTrigger id="token-replacement" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tokenReplacementOptions(designSystem, pendingDelete).map(
                  (option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              onClick={handleClick}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmDelete}
              size="sm"
              type="button"
              variant="destructive"
            >
              Apply and delete
            </Button>
          </div>
        </StatusMessage>
      ) : null}

      <ColorTokenSection
        document={document}
        onDelete={requestDelete}
        onDuplicate={duplicate}
        onMove={move}
        onOpenEditor={setOpenEditor}
        onToggleEditor={toggleEditor}
        openEditor={openEditor}
        tokens={designSystem.colors}
        updateSystem={updateSystem}
      />

      <BackgroundTokenSection
        document={document}
        onDelete={requestDelete}
        onDuplicate={duplicate}
        onMove={move}
        onOpenEditor={setOpenEditor}
        onToggleEditor={toggleEditor}
        openEditor={openEditor}
        tokens={designSystem.backgrounds}
        updateDocument={editor.updateDocument}
        updateSystem={updateSystem}
      />

      <ShadowTokenSection
        document={document}
        onDelete={requestDelete}
        onDuplicate={duplicate}
        onMove={move}
        onOpenEditor={setOpenEditor}
        onToggleEditor={toggleEditor}
        openEditor={openEditor}
        tokens={designSystem.shadows}
        updateSystem={updateSystem}
      />

      <MotionTokenSection
        onDelete={requestDelete}
        onDuplicate={duplicate}
        onMove={move}
        onOpenEditor={setOpenEditor}
        onToggleEditor={toggleEditor}
        openEditor={openEditor}
        tokens={motions}
        updateSystem={updateSystem}
      />
    </section>
  );
}
