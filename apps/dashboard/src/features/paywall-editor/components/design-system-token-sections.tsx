import {
  BackgroundEditor,
  ColorControl,
  MotionEditor,
  SectionHeading,
  ShadowEditor,
  TokenActions,
  TokenSummary,
} from "@/features/paywall-editor/components/design-system-controls";
import {
  FIELD_CLASS,
  nextTokenId,
  type PendingDelete,
} from "@/features/paywall-editor/components/design-system-controls-support";
import type {
  MosaicDocument,
  MotionToken,
  PaywallDesignSystem,
} from "@/features/paywall-editor/types/editor";
import { withDocumentParts } from "@/features/paywall-editor/utils/document-version";
import type { DesignCategory } from "@/features/paywall-editor/utils/style-authoring";
import {
  appendBackgroundAsset,
  defaultMediaBackground,
} from "@/features/paywall-editor/utils/style-authoring";
import type {
  MosaicPaywallV04BackgroundToken,
  MosaicPaywallV04ColorToken,
  MosaicPaywallV04ShadowToken,
} from "@/lib/mosaic-protocol";

interface TokenSectionProps {
  document: MosaicDocument;
  onDelete: (category: DesignCategory, id: string) => void;
  onDuplicate: (category: DesignCategory, id: string) => void;
  onMove: (category: DesignCategory, id: string, offset: -1 | 1) => void;
  onOpenEditor: (next: PendingDelete) => void;
  onToggleEditor: (category: DesignCategory, id: string) => void;
  openEditor: PendingDelete | null;
  updateSystem: (
    updater: (current: PaywallDesignSystem) => PaywallDesignSystem
  ) => void;
}

export function ColorTokenSection({
  document,
  onDelete,
  onDuplicate,
  onMove,
  onOpenEditor,
  onToggleEditor,
  openEditor,
  tokens,
  updateSystem,
}: TokenSectionProps & { tokens: readonly MosaicPaywallV04ColorToken[] }) {
  function updateColor(
    id: string,
    updater: (token: MosaicPaywallV04ColorToken) => MosaicPaywallV04ColorToken
  ) {
    updateSystem((current) => ({
      ...current,
      colors: current.colors.map((token) =>
        token.id === id ? updater(token) : token
      ),
    }));
  }

  function addColor() {
    const id = nextTokenId(tokens, "colour");
    updateSystem((current) => ({
      ...current,
      colors: [
        ...current.colors,
        { id, name: `Colour ${current.colors.length + 1}`, value: "#087F73FF" },
      ],
    }));
    onOpenEditor({ category: "colors", id });
  }

  return (
    <section className="space-y-3 border-border border-t pt-4">
      <SectionHeading count={tokens.length} label="Colours" onAdd={addColor} />
      {tokens.length === 0 ? (
        <p className="rounded border border-dashed p-3 text-muted-foreground text-xs">
          Add colours to make them available at the top of every colour picker.
        </p>
      ) : (
        <ul className="space-y-2">
          {tokens.map((token, index) => (
            <li className="rounded border border-border p-1" key={token.id}>
              <div className="flex items-center gap-1">
                <TokenSummary
                  editorId={`design-colour-editor-${token.id}`}
                  name={token.name}
                  onToggle={() => onToggleEditor("colors", token.id)}
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
                  canMoveDown={index < tokens.length - 1}
                  canMoveUp={index > 0}
                  name={token.name}
                  onDelete={() => onDelete("colors", token.id)}
                  onDuplicate={() => onDuplicate("colors", token.id)}
                  onMove={(offset) => onMove("colors", token.id, offset)}
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
  );
}

export function BackgroundTokenSection({
  document,
  onDelete,
  onDuplicate,
  onMove,
  onOpenEditor,
  onToggleEditor,
  openEditor,
  tokens,
  updateDocument,
  updateSystem,
}: TokenSectionProps & {
  tokens: readonly MosaicPaywallV04BackgroundToken[];
  updateDocument: (
    updater: (current: MosaicDocument) => MosaicDocument
  ) => void;
}) {
  function updateBackground(
    id: string,
    updater: (
      token: MosaicPaywallV04BackgroundToken
    ) => MosaicPaywallV04BackgroundToken
  ) {
    updateSystem((current) => ({
      ...current,
      backgrounds: current.backgrounds.map((token) =>
        token.id === id ? updater(token) : token
      ),
    }));
  }

  function addBackground() {
    const id = nextTokenId(tokens, "background");
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
    onOpenEditor({ category: "backgrounds", id });
  }

  function addMediaBackground(id: string, type: "image" | "video") {
    updateDocument((current) => {
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

  return (
    <section className="space-y-3 border-border border-t pt-4">
      <SectionHeading
        count={tokens.length}
        label="Backgrounds"
        onAdd={addBackground}
      />
      {tokens.length === 0 ? (
        <p className="rounded border border-dashed p-3 text-muted-foreground text-xs">
          Add a reusable colour, gradient, image, or video background.
        </p>
      ) : (
        <ul className="space-y-2">
          {tokens.map((token, index) => (
            <li className="rounded border border-border p-1" key={token.id}>
              <div className="flex items-center gap-1">
                <TokenSummary
                  editorId={`design-background-editor-${token.id}`}
                  name={token.name}
                  onToggle={() => onToggleEditor("backgrounds", token.id)}
                  open={
                    openEditor?.category === "backgrounds" &&
                    openEditor.id === token.id
                  }
                  summary={token.value.type.replace(/([A-Z])/g, " $1")}
                />
                <TokenActions
                  canMoveDown={index < tokens.length - 1}
                  canMoveUp={index > 0}
                  name={token.name}
                  onDelete={() => onDelete("backgrounds", token.id)}
                  onDuplicate={() => onDuplicate("backgrounds", token.id)}
                  onMove={(offset) => onMove("backgrounds", token.id, offset)}
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
  );
}

export function ShadowTokenSection({
  document,
  onDelete,
  onDuplicate,
  onMove,
  onOpenEditor,
  onToggleEditor,
  openEditor,
  tokens,
  updateSystem,
}: TokenSectionProps & { tokens: readonly MosaicPaywallV04ShadowToken[] }) {
  function updateShadow(
    id: string,
    updater: (token: MosaicPaywallV04ShadowToken) => MosaicPaywallV04ShadowToken
  ) {
    updateSystem((current) => ({
      ...current,
      shadows: current.shadows.map((token) =>
        token.id === id ? updater(token) : token
      ),
    }));
  }

  function addShadow() {
    const id = nextTokenId(tokens, "shadow");
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
    onOpenEditor({ category: "shadows", id });
  }

  return (
    <section className="space-y-3 border-border border-t pt-4">
      <SectionHeading count={tokens.length} label="Shadows" onAdd={addShadow} />
      {tokens.length === 0 ? (
        <p className="rounded border border-dashed p-3 text-muted-foreground text-xs">
          Add a reusable native shadow effect.
        </p>
      ) : (
        <ul className="space-y-2">
          {tokens.map((token, index) => (
            <li className="rounded border border-border p-1" key={token.id}>
              <div className="flex items-center gap-1">
                <TokenSummary
                  editorId={`design-shadow-editor-${token.id}`}
                  name={token.name}
                  onToggle={() => onToggleEditor("shadows", token.id)}
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
                  canMoveDown={index < tokens.length - 1}
                  canMoveUp={index > 0}
                  name={token.name}
                  onDelete={() => onDelete("shadows", token.id)}
                  onDuplicate={() => onDuplicate("shadows", token.id)}
                  onMove={(offset) => onMove("shadows", token.id, offset)}
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
  );
}

export function MotionTokenSection({
  onDelete,
  onDuplicate,
  onMove,
  onOpenEditor,
  onToggleEditor,
  openEditor,
  tokens,
  updateSystem,
}: Omit<TokenSectionProps, "document"> & {
  tokens: readonly MotionToken[];
}) {
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
    const id = nextTokenId(tokens, "motion");
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
    onOpenEditor({ category: "motions", id });
  }

  return (
    <section className="space-y-3 border-border border-t pt-4">
      <SectionHeading count={tokens.length} label="Motion" onAdd={addMotion} />
      {tokens.length === 0 ? (
        <p className="rounded border border-dashed p-3 text-muted-foreground text-xs">
          Add a reusable duration and easing curve. A motion token that nothing
          references is rejected, so add one when a node needs it.
        </p>
      ) : (
        <ul className="space-y-2">
          {tokens.map((token, index) => (
            <li className="rounded border border-border p-1" key={token.id}>
              <div className="flex items-center gap-1">
                <TokenSummary
                  editorId={`design-motion-editor-${token.id}`}
                  name={token.name}
                  onToggle={() => onToggleEditor("motions", token.id)}
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
                  canMoveDown={index < tokens.length - 1}
                  canMoveUp={index > 0}
                  name={token.name}
                  onDelete={() => onDelete("motions", token.id)}
                  onDuplicate={() => onDuplicate("motions", token.id)}
                  onMove={(offset) => onMove("motions", token.id, offset)}
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
  );
}
