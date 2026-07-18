import { protocolV02Paths, protocolV02Root } from "./validation-v0.2.mjs";
import { validateBrowserContractGeneration } from "./browser-contract-validation.mjs";
import {
  loadProtocolV02Artifacts,
  validateCanonicalV02Coverage,
  validateProtocolV02,
  validateV02JsonFormatting,
} from "./validation-v0.2.mjs";
import {
  loadPreviewV02Artifacts,
  validatePreviewV02Artifacts,
  validatePreviewV02JsonFormatting,
} from "./preview-validation-v0.2.mjs";
import { relative } from "node:path";

try {
  const artifactsV02 = loadProtocolV02Artifacts();
  const previewArtifactsV02 = loadPreviewV02Artifacts();
  const errors = [
    ...validateBrowserContractGeneration(),
    ...validateProtocolV02(artifactsV02),
    ...validateProtocolV02({
      ...artifactsV02,
      document: artifactsV02.edgeDocument,
    }),
    ...validateProtocolV02({
      ...artifactsV02,
      document: artifactsV02.expiredCountdownDocument,
    }),
    ...validateProtocolV02({
      ...artifactsV02,
      document: artifactsV02.hiddenPurchaseTargetDocument,
    }),
    ...validateProtocolV02({
      ...artifactsV02,
      document: artifactsV02.navigationOnlyDocument,
    }),
    ...validateCanonicalV02Coverage(artifactsV02.document),
    ...validateV02JsonFormatting(),
    ...validatePreviewV02Artifacts(previewArtifactsV02),
    ...validatePreviewV02JsonFormatting(),
  ];

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `Validated ${relative(protocolV02Root, protocolV02Paths.canonicalFixture)} ` +
        "against the Mosaic Protocol 0.2 schema and compatibility manifest; " +
        "validated Local Preview 0.2 fixtures and the browser contract.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
