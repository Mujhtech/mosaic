import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import WebSocket from "ws"

import { validatePaywallDocument } from "../../../protocol/browser/index.js"

const debuggingEndpoint = process.env.MOSAIC_CHROME_DEBUG_URL ?? "http://127.0.0.1:9223"
const startedAt = Date.now()
const finalHeadline = "Edit once, preview natively everywhere"
const artifactsDirectory = await mkdtemp(join(tmpdir(), "mosaic-phase2c-browser-demo-"))
const validationScreenshot = join(artifactsDirectory, "studio-validation-error.png")
const finalScreenshot = join(artifactsDirectory, "studio-final.png")

const targets = await fetch(`${debuggingEndpoint}/json/list`).then((response) => response.json())
const target = targets.find((entry) => entry.type === "page" && entry.url.includes("/studio"))
if (!target?.webSocketDebuggerUrl) {
  throw new Error(`No /studio Chrome target is available at ${debuggingEndpoint}.`)
}

const cdp = await connectCdp(target.webSocketDebuggerUrl)
await cdp.send("Page.enable")
await cdp.send("Runtime.enable")
await cdp.send("Page.setDownloadBehavior", {
  behavior: "allow",
  downloadPath: artifactsDirectory,
})

await cdp.evaluate("localStorage.clear()")
await cdp.send("Page.reload", { ignoreCache: true })
await waitFor("template selection", async () =>
  (await bodyText()).includes("Start from intent, not JSON"),
)
await waitFor("Studio hydration", async () =>
  cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Focused offer")
    )
    return Boolean(button && Object.keys(button).some((key) => key.startsWith("__reactProps")))
  })()`),
)

await clickButtonContaining("Focused offer")
await waitFor("editor shell", async () => (await bodyText()).includes("Paywall order"))

await clickCanvasComponent("headline")
await waitFor("headline inspector", async () =>
  Boolean(await elementValue("#property-headline-value")),
)
await setElementValue("#property-headline-value", finalHeadline)
await moveSelectedLayerDown()

await clickCanvasComponent("monthly-card")
await waitFor(
  "monthly Product Card inspector",
  async () => (await elementChecked("#property-monthly-card-initialProductCardId")) !== null,
)
await clickElement("#property-monthly-card-initialProductCardId")
await waitFor("monthly Product Card selection", async () =>
  Boolean(await elementChecked("#property-monthly-card-initialProductCardId")),
)
await clickCanvasComponent("yearly-card")
await waitFor(
  "yearly Product Card inspector",
  async () => (await elementChecked("#property-yearly-card-initialProductCardId")) === false,
)
await clickElement("#property-yearly-card-initialProductCardId")
await waitFor("yearly Product Card selection", async () =>
  Boolean(await elementChecked("#property-yearly-card-initialProductCardId")),
)
await setElementValue("#mock-outcome", "purchaseSuccess")

await clickButtonContaining("Layers")
await waitFor("Layers panel", async () =>
  (await bodyText()).includes("Drag anywhere on a layer row to reorder."),
)
await clickButtonByLabel("Add screen or sheet")
await clickRoleContaining("menuitem", "Add sheet")
await waitFor("Sheet destination", async () => (await bodyText()).includes("Sheet · screen-2"))

await clickCanvasComponent("headline")
await waitFor(
  "headline re-selection",
  async () => (await elementValue("#property-headline-value")) !== null,
)
await setElementValue("#property-headline-value", "")
await waitFor("local validation error", async () =>
  (await bodyText()).includes("Visible text cannot be empty."),
)
await scrollTo("#validation-title")
await captureScreenshot(validationScreenshot)

await setElementValue("#property-headline-value", finalHeadline)
await waitFor("validation recovery", async () =>
  (await bodyText()).includes(
    "This paywall is valid and ready to send to native previews or export.",
  ),
)
await waitFor(
  "three native acknowledgements",
  async () => (await exactTextCount("Updated")) >= 3,
  25_000,
)

const finalBody = await bodyText()
for (const clientLabel of [
  "Flutter example preview",
  "Mosaic iOS local preview",
  "Android example preview",
]) {
  if (!finalBody.includes(clientLabel)) {
    throw new Error(`Studio did not display the connected client: ${clientLabel}.`)
  }
}

await clickButtonContaining("Export")
const exportedFile = await waitForExport()
const exported = JSON.parse(await readFile(exportedFile, "utf8"))
const validation = validatePaywallDocument(exported)
if (!validation.ok) throw new Error("The browser-exported document is not Protocol 0.2 valid.")

const initialScreen = exported.screens.find((screen) => screen.id === exported.initialScreenId)
if (!initialScreen || initialScreen.presentation?.type !== "screen") {
  throw new Error("The browser export does not preserve its initial Screen.")
}
const children = initialScreen.layout.content.children
const headlineIndex = children.findIndex((node) => node.id === "headline")
const subtitleIndex = children.findIndex((node) => node.id === "subtitle")
const headlineNode = children.find((node) => node.id === "headline")
const productSelector = children.find((node) => node.id === "plans")
const selectedProductCard = productSelector?.cards?.find(
  (card) => card.id === productSelector.initialProductCardId,
)
const sheet = exported.screens.find((screen) => screen.id === "screen-2")
const sheetNavigation = children.find(
  (node) =>
    node.type === "button" &&
    node.action?.type === "navigateTo" &&
    node.action.screenId === sheet?.id,
)
if (headlineNode?.value?.default !== finalHeadline) {
  throw new Error("The exported headline does not match the browser edit.")
}
if (subtitleIndex < 0 || headlineIndex !== subtitleIndex + 1) {
  throw new Error("The exported document does not preserve the browser reorder.")
}
if (
  productSelector?.type !== "productSelector" ||
  productSelector.initialProductCardId !== "yearly-card" ||
  selectedProductCard?.productReferenceId !== "yearly-plan"
) {
  throw new Error("The exported Product Selector does not select the authored yearly Product Card.")
}
if (sheet?.presentation?.type !== "sheet" || !sheetNavigation) {
  throw new Error("The exported document does not preserve the new Sheet and its navigation edge.")
}

await scrollTo("#native-preview-title")
await captureScreenshot(finalScreenshot)

const result = {
  template: "Focused offer",
  headline: finalHeadline,
  reorder: "headline-after-subtitle",
  selectedProductCard: "yearly-card",
  selectedMockProduct: "yearly-plan",
  destinations: exported.screens.map((screen) => ({
    id: screen.id,
    presentation: screen.presentation.type,
  })),
  sheetNavigationButton: sheetNavigation.id,
  validationErrorObserved: true,
  validationRecovered: true,
  connectedNativeClients: 3,
  nativeAcknowledgements: await exactTextCount("Updated"),
  export: {
    path: exportedFile,
    protocolValid: validation.ok,
  },
  screenshots: {
    validationError: validationScreenshot,
    finalStudio: finalScreenshot,
  },
  elapsedSeconds: Number(((Date.now() - startedAt) / 1_000).toFixed(2)),
}

console.log(JSON.stringify(result, null, 2))
cdp.close()

async function bodyText() {
  return cdp.evaluate("document.body?.innerText ?? ''")
}

async function elementValue(selector) {
  return cdp.evaluate(
    `(() => { const element = document.querySelector(${JSON.stringify(selector)}); return element ? element.value : null })()`,
  )
}

async function elementChecked(selector) {
  return cdp.evaluate(
    `(() => { const element = document.querySelector(${JSON.stringify(selector)}); return element instanceof HTMLInputElement ? element.checked : null })()`,
  )
}

async function exactTextCount(text) {
  return cdp.evaluate(
    `([...document.querySelectorAll("body *")].filter((element) => element.children.length === 0 && element.textContent?.trim() === ${JSON.stringify(text)})).length`,
  )
}

async function clickButtonContaining(text) {
  const clicked = await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes(${JSON.stringify(text)})
    )
    if (!button) return false
    button.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Could not find a button containing: ${text}.`)
}

async function clickButtonByLabel(label) {
  const clicked = await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) =>
      candidate.getAttribute("aria-label") === ${JSON.stringify(label)}
    )
    if (!button) return false
    button.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Could not find a button labelled: ${label}.`)
}

async function clickRoleContaining(role, text) {
  const selector = `[role="${role}"]`
  const clicked = await cdp.evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find((candidate) =>
      candidate.textContent?.includes(${JSON.stringify(text)})
    )
    if (!element) return false
    element.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Could not find ${role} containing: ${text}.`)
}

async function clickElement(selector) {
  const clicked = await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!(element instanceof HTMLElement)) return false
    element.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Could not click element: ${selector}.`)
}

async function clickCanvasComponent(componentId) {
  const selector = `[data-component-id="${componentId}"][data-preview-node-type]`
  const clicked = await cdp.evaluate(`(() => {
    const component = document.querySelector(${JSON.stringify(selector)})
    if (!component) return false
    component.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Could not select canvas component: ${componentId}.`)
}

async function moveSelectedLayerDown() {
  const moved = await cdp.evaluate(`(() => {
    const row = document.querySelector('[role="treeitem"][aria-selected="true"]')
    if (!row) return false
    row.focus()
    row.dispatchEvent(new KeyboardEvent("keydown", {
      altKey: true,
      bubbles: true,
      key: "ArrowDown",
    }))
    return true
  })()`)
  if (!moved) throw new Error("Could not move the selected layer down.")
}

async function setElementValue(selector, value) {
  const changed = await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return false
    element.focus()
    const prototype = element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
    setter?.call(element, ${JSON.stringify(value)})
    element.dispatchEvent(new Event("input", { bubbles: true }))
    element.dispatchEvent(new Event("change", { bubbles: true }))
    element.blur()
    return true
  })()`)
  if (!changed) throw new Error(`Could not set element value: ${selector}.`)
  await new Promise((resolve) => setTimeout(resolve, 100))
}

async function scrollTo(selector) {
  await cdp.evaluate(
    `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "start" })`,
  )
  await new Promise((resolve) => setTimeout(resolve, 150))
}

async function captureScreenshot(path) {
  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  })
  await writeFile(path, screenshot.data, "base64")
}

async function waitForExport() {
  const exportDeadline = Date.now() + 10_000
  while (Date.now() < exportDeadline) {
    const files = (await readdir(artifactsDirectory)).filter((file) =>
      file.endsWith(".mosaic.json"),
    )
    if (files.length === 1) return join(artifactsDirectory, files[0])
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("Studio did not download one exported Mosaic document.")
}

async function waitFor(label, predicate, timeout = 15_000) {
  const waitDeadline = Date.now() + timeout
  while (Date.now() < waitDeadline) {
    try {
      if (await predicate()) return
    } catch {
      // Navigation can briefly invalidate the execution context.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${label}.`)
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.once("open", resolve)
    socket.once("error", reject)
  })
  let sequence = 0
  const pending = new Map()
  socket.on("message", (source) => {
    const message = JSON.parse(source.toString())
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })

  function send(method, params = {}) {
    const id = ++sequence
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  return {
    send,
    async evaluate(expression) {
      const response = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.text ?? "Chrome evaluation failed.")
      }
      return response.result.value
    },
    close() {
      socket.close()
    },
  }
}
