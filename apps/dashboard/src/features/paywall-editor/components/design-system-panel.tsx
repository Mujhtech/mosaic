import { StatusMessage } from "@mosaic/design-system"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type { MosaicDocument, PaywallDesignSystem } from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import {
  appendBackgroundAsset,
  defaultMediaBackground,
  isSafeTokenReplacement,
  tokenReferenceType,
} from "@/features/paywall-editor/utils/style-authoring"
import type { DesignCategory } from "@/features/paywall-editor/utils/style-authoring"
import type {
  MosaicPaywallV02BackgroundToken,
  MosaicPaywallV02ColorToken,
  MosaicPaywallV02ShadowToken,
} from "@/lib/mosaic-protocol"

import {
  BackgroundEditor,
  ColorControl,
  FIELD_CLASS,
  SectionHeading,
  ShadowEditor,
  TokenActions,
  TokenSummary,
  countTokenReferences,
  nextTokenId,
  replaceTokenReferences,
  tokensFor,
  type DesignToken,
  type PendingDelete,
} from "@/features/paywall-editor/components/design-system-controls"

export function DesignSystemPanel() {
  const { document } = useEditorStore()
  const editor = useEditorActions()
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [replacementId, setReplacementId] = useState("detach")
  const [openEditor, setOpenEditor] = useState<PendingDelete | null>(null)

  if (!document) return null
  const designSystem = document.designSystem

  function updateSystem(updater: (current: PaywallDesignSystem) => PaywallDesignSystem) {
    editor.updateDocument((current) => ({
      ...current,
      designSystem: updater(current.designSystem),
    }))
  }

  function updateColor(
    id: string,
    updater: (token: MosaicPaywallV02ColorToken) => MosaicPaywallV02ColorToken,
  ) {
    updateSystem((current) => ({
      ...current,
      colors: current.colors.map((token) => (token.id === id ? updater(token) : token)),
    }))
  }
  function updateBackground(
    id: string,
    updater: (token: MosaicPaywallV02BackgroundToken) => MosaicPaywallV02BackgroundToken,
  ) {
    updateSystem((current) => ({
      ...current,
      backgrounds: current.backgrounds.map((token) => (token.id === id ? updater(token) : token)),
    }))
  }
  function updateShadow(
    id: string,
    updater: (token: MosaicPaywallV02ShadowToken) => MosaicPaywallV02ShadowToken,
  ) {
    updateSystem((current) => ({
      ...current,
      shadows: current.shadows.map((token) => (token.id === id ? updater(token) : token)),
    }))
  }

  function deleteNow(category: DesignCategory, id: string) {
    updateSystem((current) => {
      if (category === "colors")
        return { ...current, colors: current.colors.filter((token) => token.id !== id) }
      if (category === "backgrounds")
        return { ...current, backgrounds: current.backgrounds.filter((token) => token.id !== id) }
      return { ...current, shadows: current.shadows.filter((token) => token.id !== id) }
    })
    if (openEditor?.category === category && openEditor.id === id) setOpenEditor(null)
  }

  function requestDelete(category: DesignCategory, id: string) {
    if (countTokenReferences(document, tokenReferenceType(category), id) === 0) {
      deleteNow(category, id)
      return
    }
    setReplacementId("detach")
    setPendingDelete({ category, id })
  }

  function confirmDelete() {
    if (!pendingDelete) return
    const tokens = tokensFor(designSystem, pendingDelete.category)
    const currentToken = tokens.find((token) => token.id === pendingDelete.id)
    if (!currentToken) return
    const replacementToken = tokens.find((token) => token.id === replacementId)
    if (
      replacementToken &&
      !isSafeTokenReplacement(
        designSystem,
        pendingDelete.category,
        pendingDelete.id,
        replacementToken.id,
      )
    ) {
      setReplacementId("detach")
      return
    }
    const replacement = replacementToken
      ? { type: tokenReferenceType(pendingDelete.category), id: replacementToken.id }
      : cloneValue(currentToken.value)
    editor.updateDocument((current) => {
      const replaced = replaceTokenReferences(
        current,
        tokenReferenceType(pendingDelete.category),
        pendingDelete.id,
        replacement,
      ) as MosaicDocument
      if (pendingDelete.category === "colors")
        return {
          ...replaced,
          designSystem: {
            ...replaced.designSystem,
            colors: replaced.designSystem.colors.filter((token) => token.id !== pendingDelete.id),
          },
        }
      if (pendingDelete.category === "backgrounds")
        return {
          ...replaced,
          designSystem: {
            ...replaced.designSystem,
            backgrounds: replaced.designSystem.backgrounds.filter(
              (token) => token.id !== pendingDelete.id,
            ),
          },
        }
      return {
        ...replaced,
        designSystem: {
          ...replaced.designSystem,
          shadows: replaced.designSystem.shadows.filter((token) => token.id !== pendingDelete.id),
        },
      }
    })
    setPendingDelete(null)
    if (openEditor?.category === pendingDelete.category && openEditor.id === pendingDelete.id) {
      setOpenEditor(null)
    }
  }

  function addColor() {
    const id = nextTokenId(designSystem.colors, "colour")
    updateSystem((current) => ({
      ...current,
      colors: [
        ...current.colors,
        { id, name: `Colour ${current.colors.length + 1}`, value: "#087F73FF" },
      ],
    }))
    setOpenEditor({ category: "colors", id })
  }

  function addBackground() {
    const id = nextTokenId(designSystem.backgrounds, "background")
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
    }))
    setOpenEditor({ category: "backgrounds", id })
  }

  function addShadow() {
    const id = nextTokenId(designSystem.shadows, "shadow")
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
    }))
    setOpenEditor({ category: "shadows", id })
  }

  function addMediaBackground(id: string, type: "image" | "video") {
    editor.updateDocument((current) => {
      const result = appendBackgroundAsset(current, type)
      return {
        ...result.document,
        designSystem: {
          ...result.document.designSystem,
          backgrounds: result.document.designSystem.backgrounds.map((token) =>
            token.id === id
              ? { ...token, value: defaultMediaBackground(type, result.assetId) }
              : token,
          ),
        },
      }
    })
  }

  function toggleEditor(category: DesignCategory, id: string) {
    setOpenEditor((current) =>
      current?.category === category && current.id === id ? null : { category, id },
    )
  }

  function move(category: DesignCategory, id: string, offset: -1 | 1) {
    updateSystem((current) => {
      const reorder = <Token extends DesignToken>(tokens: readonly Token[]) => {
        const index = tokens.findIndex((token) => token.id === id)
        const target = index + offset
        if (index < 0 || target < 0 || target >= tokens.length) return [...tokens]
        const next = [...tokens]
        const [token] = next.splice(index, 1)
        if (token) next.splice(target, 0, token)
        return next
      }
      if (category === "colors") return { ...current, colors: reorder(current.colors) }
      if (category === "backgrounds")
        return { ...current, backgrounds: reorder(current.backgrounds) }
      return { ...current, shadows: reorder(current.shadows) }
    })
  }

  function duplicate(category: DesignCategory, id: string) {
    updateSystem((current) => {
      if (category === "colors") {
        const source = current.colors.find((token) => token.id === id)
        return source
          ? {
              ...current,
              colors: [
                ...current.colors,
                {
                  ...cloneValue(source),
                  id: nextTokenId(current.colors, "colour"),
                  name: `${source.name} copy`,
                },
              ],
            }
          : current
      }
      if (category === "backgrounds") {
        const source = current.backgrounds.find((token) => token.id === id)
        return source
          ? {
              ...current,
              backgrounds: [
                ...current.backgrounds,
                {
                  ...cloneValue(source),
                  id: nextTokenId(current.backgrounds, "background"),
                  name: `${source.name} copy`,
                },
              ],
            }
          : current
      }
      const source = current.shadows.find((token) => token.id === id)
      return source
        ? {
            ...current,
            shadows: [
              ...current.shadows,
              {
                ...cloneValue(source),
                id: nextTokenId(current.shadows, "shadow"),
                name: `${source.name} copy`,
              },
            ],
          }
        : current
    })
  }

  return (
    <section aria-labelledby="design-system-panel-title" className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold" id="design-system-panel-title">
          Design System
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs leading-5">
          Reusable paywall colours, backgrounds, and shadows. Linked changes update every usage.
        </p>
      </div>

      {pendingDelete ? (
        <StatusMessage
          className="border-warning/30 bg-warning/5 space-y-2 rounded-lg border p-3 text-xs"
          tone="warning"
        >
          <p className="font-medium">This style is in use.</p>
          <label className="grid gap-1">
            <span>Replace usages or detach their current values</span>
            <select
              className={FIELD_CLASS}
              onChange={(event) => setReplacementId(event.target.value)}
              value={replacementId}
            >
              <option value="detach">Detach current values</option>
              {tokensFor(designSystem, pendingDelete.category).flatMap((token) =>
                isSafeTokenReplacement(
                  designSystem,
                  pendingDelete.category,
                  pendingDelete.id,
                  token.id,
                ) ? (
                  <option key={token.id} value={token.id}>
                    Replace usages with {token.name}
                  </option>
                ) : (
                  []
                ),
              )}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPendingDelete(null)} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button onClick={confirmDelete} size="sm" type="button" variant="destructive">
              Apply and delete
            </Button>
          </div>
        </StatusMessage>
      ) : null}

      <section className="border-border space-y-3 border-t pt-4">
        <SectionHeading count={designSystem.colors.length} label="Colours" onAdd={addColor} />
        {designSystem.colors.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
            Add colours to make them available at the top of every colour picker.
          </p>
        ) : (
          <ul className="space-y-2">
            {designSystem.colors.map((token, index) => (
              <li className="border-border rounded-lg border p-1" key={token.id}>
                <div className="flex items-center gap-1">
                  <TokenSummary
                    editorId={`design-colour-editor-${token.id}`}
                    name={token.name}
                    onToggle={() => toggleEditor("colors", token.id)}
                    open={openEditor?.category === "colors" && openEditor.id === token.id}
                    summary={
                      typeof token.value === "string" ? token.value : `Linked · ${token.value.id}`
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
                {openEditor?.category === "colors" && openEditor.id === token.id ? (
                  <div
                    className="border-border space-y-2 border-t p-2"
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
                        updateColor(token.id, (current) => ({ ...current, value }))
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

      <section className="border-border space-y-3 border-t pt-4">
        <SectionHeading
          count={designSystem.backgrounds.length}
          label="Backgrounds"
          onAdd={addBackground}
        />
        {designSystem.backgrounds.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
            Add a reusable colour, gradient, image, or video background.
          </p>
        ) : (
          <ul className="space-y-2">
            {designSystem.backgrounds.map((token, index) => (
              <li className="border-border rounded-lg border p-1" key={token.id}>
                <div className="flex items-center gap-1">
                  <TokenSummary
                    editorId={`design-background-editor-${token.id}`}
                    name={token.name}
                    onToggle={() => toggleEditor("backgrounds", token.id)}
                    open={openEditor?.category === "backgrounds" && openEditor.id === token.id}
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
                {openEditor?.category === "backgrounds" && openEditor.id === token.id ? (
                  <div
                    className="border-border space-y-2 border-t p-2"
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
                        updateBackground(token.id, (current) => ({ ...current, value }))
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

      <section className="border-border space-y-3 border-t pt-4">
        <SectionHeading count={designSystem.shadows.length} label="Shadows" onAdd={addShadow} />
        {designSystem.shadows.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
            Add a reusable native shadow effect.
          </p>
        ) : (
          <ul className="space-y-2">
            {designSystem.shadows.map((token, index) => (
              <li className="border-border rounded-lg border p-1" key={token.id}>
                <div className="flex items-center gap-1">
                  <TokenSummary
                    editorId={`design-shadow-editor-${token.id}`}
                    name={token.name}
                    onToggle={() => toggleEditor("shadows", token.id)}
                    open={openEditor?.category === "shadows" && openEditor.id === token.id}
                    summary={
                      token.value.type === "shadow" ? `${token.value.blurRadius}px blur` : "Linked"
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
                {openEditor?.category === "shadows" && openEditor.id === token.id ? (
                  <div
                    className="border-border space-y-2 border-t p-2"
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
                        updateShadow(token.id, (current) => ({ ...current, value }))
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
    </section>
  )
}
