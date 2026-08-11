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
  BackgroundEditor,
  ColorControl,
  countTokenReferences,
  FIELD_CLASS,
  MotionEditor,
  nextTokenId,
  type PendingDelete,
  replaceTokenReferences,
  SectionHeading,
  ShadowEditor,
  TokenActions,
  TokenSummary,
  tokensFor,
  withDuplicatedToken,
  withMovedToken,
  withoutToken,
} from "@/features/paywall-editor/components/design-system-controls";
import { UpgradeToV04Dialog } from "@/features/paywall-editor/components/upgrade-to-v04-dialog";
import { upgradeDocumentToV04 } from "@/features/paywall-editor/mutations/upgrade-to-v04";
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context";
import type {
  MosaicDocument,
  MotionToken,
  PaywallDesignSystem,
} from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import {
  documentMotionTokens,
  isMotionCapableDocument,
  withDocumentParts,
} from "@/features/paywall-editor/utils/document-version";
import type { DesignCategory } from "@/features/paywall-editor/utils/style-authoring";
import {
  appendBackgroundAsset,
  defaultMediaBackground,
  isSafeTokenReplacement,
  tokenReferenceType,
} from "@/features/paywall-editor/utils/style-authoring";
import type {
  MosaicPaywallV03BackgroundToken,
  MosaicPaywallV03ColorToken,
  MosaicPaywallV03ShadowToken,
} from "@/lib/mosaic-protocol";

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
    ...tokensFor(designSystem, pendingDelete.category)
      .filter((token) =>
        isSafeTokenReplacement(
          designSystem,
          pendingDelete.category,
          pendingDelete.id,
          token.id
        )
      )
      .map((token) => ({
        label: `Replace usages with ${token.name}`,
        value: token.id,
      })),
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
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [openEditor, setOpenEditor] = useState<PendingDelete | null>(null);

  if (!document) {
    return null;
  }
  const { designSystem } = document;
  // The motions catalog exists only on 0.4. A 0.3 document shows the three
  // catalogs it has always shown, and the Motion section is absent rather than
  // present-and-empty: an empty section would read as "no motions authored"
  // when the truth is "this contract version cannot carry them".
  const motions = documentMotionTokens(document);
  const supportsMotion = isMotionCapableDocument(document);

  function updateSystem(
    updater: (current: PaywallDesignSystem) => PaywallDesignSystem
  ) {
    editor.updateDocument((current) =>
      withDocumentParts(current, {
        designSystem: updater(current.designSystem),
      })
    );
  }

  function updateColor(
    id: string,
    updater: (token: MosaicPaywallV03ColorToken) => MosaicPaywallV03ColorToken
  ) {
    updateSystem((current) => ({
      ...current,
      colors: current.colors.map((token) =>
        token.id === id ? updater(token) : token
      ),
    }));
  }
  function updateBackground(
    id: string,
    updater: (
      token: MosaicPaywallV03BackgroundToken
    ) => MosaicPaywallV03BackgroundToken
  ) {
    updateSystem((current) => ({
      ...current,
      backgrounds: current.backgrounds.map((token) =>
        token.id === id ? updater(token) : token
      ),
    }));
  }
  function updateShadow(
    id: string,
    updater: (token: MosaicPaywallV03ShadowToken) => MosaicPaywallV03ShadowToken
  ) {
    updateSystem((current) => ({
      ...current,
      shadows: current.shadows.map((token) =>
        token.id === id ? updater(token) : token
      ),
    }));
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

  function addColor() {
    const id = nextTokenId(designSystem.colors, "colour");
    updateSystem((current) => ({
      ...current,
      colors: [
        ...current.colors,
        { id, name: `Colour ${current.colors.length + 1}`, value: "#087F73FF" },
      ],
    }));
    setOpenEditor({ category: "colors", id });
  }

  function addBackground() {
    const id = nextTokenId(designSystem.backgrounds, "background");
    updateSystem((current) => ({
      ...current,
      backgrounds: [
        ...current.backgrounds,
        {
          id,
          name: `Background ${current.backgrounds.length + 1}`,
          value: { type: "color", value: "surface.default" },
        },
      ],
    }));
    setOpenEditor({ category: "backgrounds", id });
  }

  function addShadow() {
    const id = nextTokenId(designSystem.shadows, "shadow");
    updateSystem((current) => ({
      ...current,
      shadows: [
        ...current.shadows,
        {
          id,
          name: `Shadow ${current.shadows.length + 1}`,
          value: {
            type: "shadow",
            color: "#00000033",
            offsetX: 0,
            offsetY: 8,
            blurRadius: 24,
          },
        },
      ],
    }));
    setOpenEditor({ category: "shadows", id });
  }

  function addMediaBackground(id: string, type: "image" | "video") {
    editor.updateDocument((current) => {
      const result = appendBackgroundAsset(current, type);
      return withDocumentParts(result.document, {
        designSystem: {
          ...result.document.designSystem,
          backgrounds: result.document.designSystem.backgrounds.map((token) =>
            token.id === id
              ? {
                  ...token,
                  value: defaultMediaBackground(type, result.assetId),
                }
              : token
          ),
        },
      });
    });
  }

  function toggleEditor(category: DesignCategory, id: string) {
    setOpenEditor((current) =>
      current?.category === category && current.id === id
        ? null
        : { category, id }
    );
  }

  function updateMotion(
    id: string,
    updater: (token: MotionToken) => MotionToken
  ) {
    updateSystem((current) =>
      "motions" in current
        ? {
            ...current,
            motions: current.motions.map((token) =>
              token.id === id ? updater(token) : token
            ),
          }
        : current
    );
  }

  function addMotion() {
    const id = nextTokenId(motions, "motion");
    updateSystem((current) =>
      "motions" in current
        ? {
            ...current,
            motions: [
              ...current.motions,
              {
                id,
                name: `Motion ${current.motions.length + 1}`,
                // A 240ms decelerate is the contract's own entrance example: an
                // entrance is the first motion anyone authors, and the loop
                // floor of 500ms would be the wrong default for it.
                value: {
                  type: "motion",
                  durationMilliseconds: 240,
                  easing: "decelerate",
                },
              },
            ],
          }
        : current
    );
    setOpenEditor({ category: "motions", id });
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

      <section className="space-y-3 border-border border-t pt-4">
        <SectionHeading
          count={designSystem.colors.length}
          label="Colours"
          onAdd={addColor}
        />
        {designSystem.colors.length === 0 ? (
          <p className="rounded border border-dashed p-3 text-muted-foreground text-xs">
            Add colours to make them available at the top of every colour
            picker.
          </p>
        ) : (
          <ul className="space-y-2">
            {designSystem.colors.map((token, index) => (
              <li className="rounded border border-border p-1" key={token.id}>
                <div className="flex items-center gap-1">
                  <TokenSummary
                    editorId={`design-colour-editor-${token.id}`}
                    name={token.name}
                    onToggle={() => toggleEditor("colors", token.id)}
                    open={
                      openEditor?.category === "colors" &&
                      openEditor.id === token.id
                    }
                    summary={
                      typeof token.value === "string"
                        ? token.value
                        : `Linked · ${token.value.id}`
                    }
                  />
                  <TokenActions
                    canMoveDown={index < designSystem.colors.length - 1}
                    canMoveUp={index > 0}
                    name={token.name}
                    onDelete={() => requestDelete("colors", token.id)}
                    onDuplicate={() => duplicate("colors", token.id)}
                    onMove={(offset) => move("colors", token.id, offset)}
                  />
                </div>
                {openEditor?.category === "colors" &&
                openEditor.id === token.id ? (
                  <div
                    className="space-y-2 border-border border-t p-2"
                    id={`design-colour-editor-${token.id}`}
                  >
                    <input
                      aria-label={`Name for ${token.name}`}
                      className={`${FIELD_CLASS} w-full`}
                      maxLength={80}
                      onChange={(event) =>
                        updateColor(token.id, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      value={token.name}
                    />
                    <ColorControl
                      document={document}
                      id={`design-colour-${token.id}`}
                      label={token.name}
                      onChange={(value) =>
                        updateColor(token.id, (current) => ({
                          ...current,
                          value,
                        }))
                      }
                      value={token.value}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 border-border border-t pt-4">
        <SectionHeading
          count={designSystem.backgrounds.length}
          label="Backgrounds"
          onAdd={addBackground}
        />
        {designSystem.backgrounds.length === 0 ? (
          <p className="rounded border border-dashed p-3 text-muted-foreground text-xs">
            Add a reusable colour, gradient, image, or video background.
          </p>
        ) : (
          <ul className="space-y-2">
            {designSystem.backgrounds.map((token, index) => (
              <li className="rounded border border-border p-1" key={token.id}>
                <div className="flex items-center gap-1">
                  <TokenSummary
                    editorId={`design-background-editor-${token.id}`}
                    name={token.name}
                    onToggle={() => toggleEditor("backgrounds", token.id)}
                    open={
                      openEditor?.category === "backgrounds" &&
                      openEditor.id === token.id
                    }
                    summary={token.value.type.replace(/([A-Z])/g, " $1")}
                  />
                  <TokenActions
                    canMoveDown={index < designSystem.backgrounds.length - 1}
                    canMoveUp={index > 0}
                    name={token.name}
                    onDelete={() => requestDelete("backgrounds", token.id)}
                    onDuplicate={() => duplicate("backgrounds", token.id)}
                    onMove={(offset) => move("backgrounds", token.id, offset)}
                  />
                </div>
                {openEditor?.category === "backgrounds" &&
                openEditor.id === token.id ? (
                  <div
                    className="space-y-2 border-border border-t p-2"
                    id={`design-background-editor-${token.id}`}
                  >
                    <input
                      aria-label={`Name for ${token.name}`}
                      className={`${FIELD_CLASS} w-full`}
                      maxLength={80}
                      onChange={(event) =>
                        updateBackground(token.id, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      value={token.name}
                    />
                    <BackgroundEditor
                      document={document}
                      id={`design-background-${token.id}`}
                      onAddMedia={(type) => addMediaBackground(token.id, type)}
                      onChange={(value) =>
                        updateBackground(token.id, (current) => ({
                          ...current,
                          value,
                        }))
                      }
                      value={token.value}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 border-border border-t pt-4">
        <SectionHeading
          count={designSystem.shadows.length}
          label="Shadows"
          onAdd={addShadow}
        />
        {designSystem.shadows.length === 0 ? (
          <p className="rounded border border-dashed p-3 text-muted-foreground text-xs">
            Add a reusable native shadow effect.
          </p>
        ) : (
          <ul className="space-y-2">
            {designSystem.shadows.map((token, index) => (
              <li className="rounded border border-border p-1" key={token.id}>
                <div className="flex items-center gap-1">
                  <TokenSummary
                    editorId={`design-shadow-editor-${token.id}`}
                    name={token.name}
                    onToggle={() => toggleEditor("shadows", token.id)}
                    open={
                      openEditor?.category === "shadows" &&
                      openEditor.id === token.id
                    }
                    summary={
                      token.value.type === "shadow"
                        ? `${token.value.blurRadius}px blur`
                        : "Linked"
                    }
                  />
                  <TokenActions
                    canMoveDown={index < designSystem.shadows.length - 1}
                    canMoveUp={index > 0}
                    name={token.name}
                    onDelete={() => requestDelete("shadows", token.id)}
                    onDuplicate={() => duplicate("shadows", token.id)}
                    onMove={(offset) => move("shadows", token.id, offset)}
                  />
                </div>
                {openEditor?.category === "shadows" &&
                openEditor.id === token.id ? (
                  <div
                    className="space-y-2 border-border border-t p-2"
                    id={`design-shadow-editor-${token.id}`}
                  >
                    <input
                      aria-label={`Name for ${token.name}`}
                      className={`${FIELD_CLASS} w-full`}
                      maxLength={80}
                      onChange={(event) =>
                        updateShadow(token.id, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      value={token.name}
                    />
                    <ShadowEditor
                      document={document}
                      id={`design-shadow-${token.id}`}
                      onChange={(value) =>
                        updateShadow(token.id, (current) => ({
                          ...current,
                          value,
                        }))
                      }
                      value={token.value}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {supportsMotion ? null : (
        <section className="space-y-2 border-border border-t pt-4">
          <h3 className="font-semibold text-xs">Motion</h3>
          <p className="text-muted-foreground text-xs leading-5">
            Motion needs Protocol 0.4. Upgrading adds a Motion catalog and lets
            you author entrances, selection changes, and a call-to-action pulse.
          </p>
          <Button
            onClick={() => setUpgradeOpen(true)}
            size="xs"
            type="button"
            variant="outline"
          >
            Upgrade to Protocol 0.4
          </Button>
        </section>
      )}
      {upgradeOpen ? (
        <UpgradeToV04Dialog
          onConfirm={() => {
            editor.updateDocument((current) => upgradeDocumentToV04(current));
            setUpgradeOpen(false);
          }}
          onOpenChange={setUpgradeOpen}
        />
      ) : null}
      {supportsMotion ? (
        <section className="space-y-3 border-border border-t pt-4">
          <SectionHeading
            count={motions.length}
            label="Motion"
            onAdd={addMotion}
          />
          {motions.length === 0 ? (
            <p className="rounded border border-dashed p-3 text-muted-foreground text-xs">
              Add a reusable duration and easing curve. A motion token that
              nothing references is rejected, so add one when a node needs it.
            </p>
          ) : (
            <ul className="space-y-2">
              {motions.map((token, index) => (
                <li className="rounded border border-border p-1" key={token.id}>
                  <div className="flex items-center gap-1">
                    <TokenSummary
                      editorId={`design-motion-editor-${token.id}`}
                      name={token.name}
                      onToggle={() => toggleEditor("motions", token.id)}
                      open={
                        openEditor?.category === "motions" &&
                        openEditor.id === token.id
                      }
                      summary={
                        token.value.type === "motion"
                          ? `${token.value.durationMilliseconds}ms ${token.value.easing}`
                          : "Linked"
                      }
                    />
                    <TokenActions
                      canMoveDown={index < motions.length - 1}
                      canMoveUp={index > 0}
                      name={token.name}
                      onDelete={() => requestDelete("motions", token.id)}
                      onDuplicate={() => duplicate("motions", token.id)}
                      onMove={(offset) => move("motions", token.id, offset)}
                    />
                  </div>
                  {openEditor?.category === "motions" &&
                  openEditor.id === token.id ? (
                    <div
                      className="space-y-2 border-border border-t p-2"
                      id={`design-motion-editor-${token.id}`}
                    >
                      <input
                        aria-label={`Name for ${token.name}`}
                        className={`${FIELD_CLASS} w-full`}
                        maxLength={80}
                        onChange={(event) =>
                          updateMotion(token.id, (current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        value={token.name}
                      />
                      <MotionEditor
                        id={`design-motion-${token.id}`}
                        onChange={(value) =>
                          updateMotion(token.id, (current) => ({
                            ...current,
                            value,
                          }))
                        }
                        value={token.value}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </section>
  );
}
