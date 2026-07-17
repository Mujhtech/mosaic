import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(toolsDirectory, "..");

const canonicalDocumentPath = resolve(
  protocolRoot,
  "fixtures/v0.1/complete-paywall.json",
);
const compatibilityManifestPath = resolve(
  protocolRoot,
  "compatibility/v0.1.json",
);
const fixtureDirectory = resolve(
  protocolRoot,
  "fixtures/local-preview/v0.1",
);

const sessionId = "session_phase2_demo";
const clientId = "client_flutter_example";
const editableDocumentId = "document_phase2_demo";
const sentAt = "2026-07-17T08:00:00Z";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function revision(sequence) {
  return {
    revisionId: `revision_${String(sequence).padStart(6, "0")}`,
    sequence,
  };
}

function envelope(index, type, payload) {
  return {
    previewProtocolVersion: "0.1",
    messageId: `msg_${String(index).padStart(6, "0")}`,
    sessionId,
    sentAt,
    type,
    payload,
  };
}

function recovery(action, message) {
  return { action, message };
}

function validationDiagnostic({
  code,
  message,
  documentPath,
  componentId,
  property,
  recoveryAction = "editProperty",
  recoveryMessage,
}) {
  return {
    code,
    message,
    location: {
      documentPath,
      ...(componentId ? { componentId } : {}),
      ...(property ? { property } : {}),
    },
    recovery: recovery(
      recoveryAction,
      recoveryMessage ??
        (componentId
          ? "Select the affected component and correct the highlighted property."
          : "Correct the highlighted document value and retry preview."),
    ),
  };
}

export function buildLocalPreviewFixtures() {
  const document = readJson(canonicalDocumentPath);
  const manifest = readJson(compatibilityManifestPath);
  const staleRevision = revision(1);
  const acceptedRevision = revision(2);
  const invalidRevision = revision(3);
  const failedRevision = revision(4);
  const commerceRevision = {
    revisionId: "revision_commerce_000001",
    sequence: 1,
  };
  const mockCommerceState = {
    products: [
      {
        productReferenceId: "monthly-plan",
        availability: "available",
        kind: "subscription",
        localizedPrice: "$9.99",
        currencyCode: "USD",
        billingPeriod: {
          unit: "month",
          value: 1,
        },
        trialPeriod: {
          unit: "day",
          value: 7,
        },
      },
      {
        productReferenceId: "yearly-plan",
        availability: "available",
        kind: "subscription",
        localizedPrice: "$79.99",
        currencyCode: "USD",
        billingPeriod: {
          unit: "year",
          value: 1,
        },
        introductoryOffer: {
          localizedPrice: "$39.99",
          period: {
            unit: "year",
            value: 1,
          },
          cycles: 1,
        },
      },
    ],
    purchaseOutcome: "purchased",
    restoreOutcome: "restored",
    entitlement: {
      status: "none",
    },
  };
  const client = {
    clientId,
    displayName: "Flutter example preview",
    renderer: {
      id: "mosaic.flutter",
      version: "0.1.0",
    },
    application: {
      id: "mosaic.flutter.example",
      displayName: "Mosaic Flutter Example",
      version: "0.1.0",
    },
    device: {
      displayName: "Local preview device",
      systemName: "Example OS",
      systemVersion: "1.0",
    },
  };
  const invalidDocument = structuredClone(document);
  invalidDocument.layout.content.children[5].productReferenceIds[0] =
    "missing-plan";

  const messages = [
    envelope(1, "previewClientConnected", { client }),
    envelope(2, "capabilityReport", {
      clientId,
      supportedSchemaVersions: ["0.1"],
      supportedCapabilities: manifest.capabilities.map(({ name, version }) => ({
        name,
        version,
      })),
      previewCapabilities: [
        { name: "preview.liveUpdate", version: "0.1" },
        { name: "preview.mockCommerce", version: "0.1" },
        { name: "preview.localeOverride", version: "0.1" },
        { name: "preview.textScale", version: "0.1" },
        { name: "preview.diagnostics", version: "0.1" },
      ],
      limits: {
        maxDocumentBytes: 1048576,
      },
    }),
    envelope(3, "mockCommerceStateChanged", {
      editableDocumentId,
      stateRevision: commerceRevision,
      state: mockCommerceState,
    }),
    envelope(4, "draftUpdated", {
      editableDocumentId,
      revision: acceptedRevision,
      document,
      preview: {
        locale: "en",
        textScale: 1,
      },
    }),
    envelope(5, "renderWarning", {
      clientId,
      editableDocumentId,
      revision: acceptedRevision,
      warnings: [
        {
          code: "render.assetFallback",
          severity: "warning",
          message: "The bundled image was unavailable, so its declared placeholder is visible.",
          location: {
            documentPath: "/layout/content/children/1",
            componentId: "hero",
            property: "assetId",
          },
          fallback: "useDeclaredAssetFallback",
          recovery: recovery(
            "inspectComponent",
            "Check that the host application bundles the image key used by this component.",
          ),
        },
      ],
    }),
    envelope(6, "draftAccepted", {
      clientId,
      editableDocumentId,
      revision: acceptedRevision,
    }),
    envelope(7, "draftUpdated", {
      editableDocumentId,
      revision: staleRevision,
      document,
      preview: {
        locale: "en",
        textScale: 1,
      },
    }),
    envelope(8, "draftRejected", {
      clientId,
      editableDocumentId,
      revision: staleRevision,
      reason: "staleRevision",
      diagnostics: [
        validationDiagnostic({
          code: "preview.staleRevision",
          message: "The preview client already received a newer revision.",
          documentPath: "",
          recoveryAction: "restoreLastValidDraft",
          recoveryMessage:
            "Keep the latest accepted preview and send a new increasing revision.",
        }),
      ],
    }),
    envelope(9, "draftUpdated", {
      editableDocumentId,
      revision: invalidRevision,
      document: invalidDocument,
      preview: {
        locale: "ar",
        textScale: 2,
      },
    }),
    envelope(10, "validationError", {
      clientId,
      editableDocumentId,
      revision: invalidRevision,
      errors: [
        validationDiagnostic({
          code: "validation.invalidReference",
          message: "Product selector plans references an undeclared product.",
          documentPath:
            "/layout/content/children/5/productReferenceIds/0",
          componentId: "plans",
          property: "productReferenceIds",
        }),
      ],
    }),
    envelope(11, "draftRejected", {
      clientId,
      editableDocumentId,
      revision: invalidRevision,
      reason: "validationFailed",
      diagnostics: [
        validationDiagnostic({
          code: "validation.invalidReference",
          message: "Product selector plans references an undeclared product.",
          documentPath:
            "/layout/content/children/5/productReferenceIds/0",
          componentId: "plans",
          property: "productReferenceIds",
        }),
      ],
    }),
    envelope(12, "draftUpdated", {
      editableDocumentId,
      revision: failedRevision,
      document,
      preview: {
        locale: "de",
        textScale: 1,
      },
    }),
    envelope(13, "renderFailure", {
      clientId,
      editableDocumentId,
      revision: failedRevision,
      failure: {
        code: "render.failed",
        message: "The preview client could not render this revision.",
        location: {
          documentPath: "/layout",
          componentId: "paywall-scroll",
        },
        fallback: "keepLastAcceptedDraft",
        recovery: recovery(
          "retry",
          "Retry the revision or restore the last accepted draft.",
        ),
      },
    }),
    envelope(14, "draftRejected", {
      clientId,
      editableDocumentId,
      revision: failedRevision,
      reason: "renderFailed",
      diagnostics: [
        validationDiagnostic({
          code: "render.failed",
          message: "The preview client could not render this revision.",
          documentPath: "/layout",
          componentId: "paywall-scroll",
          recoveryAction: "retry",
          recoveryMessage:
            "Retry the revision or restore the last accepted draft.",
        }),
      ],
    }),
    envelope(15, "previewHeartbeat", {
      clientId,
      kind: "ping",
      sequence: 1,
    }),
    envelope(16, "previewHeartbeat", {
      clientId,
      kind: "pong",
      sequence: 1,
    }),
    envelope(17, "previewClientDisconnected", {
      clientId,
      reason: "closed",
    }),
  ];

  const localProject = {
    fileFormatVersion: "0.1",
    editableDocumentId,
    revision: acceptedRevision,
    document,
    preview: {
      locale: "en",
      textScale: 1,
    },
    mockCommerce: {
      revision: commerceRevision,
      state: mockCommerceState,
    },
  };

  return { localProject, messages };
}

export function writeLocalPreviewFixtures() {
  const { localProject, messages } = buildLocalPreviewFixtures();
  mkdirSync(fixtureDirectory, { recursive: true });
  writeFileSync(
    resolve(fixtureDirectory, "session-flow.messages.json"),
    `${JSON.stringify(messages, null, 2)}\n`,
  );
  writeFileSync(
    resolve(fixtureDirectory, "local-project.json"),
    `${JSON.stringify(localProject, null, 2)}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeLocalPreviewFixtures();
}
