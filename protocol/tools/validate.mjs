import {
  loadProtocolArtifacts,
  protocolPaths,
  protocolRoot,
  validateCanonicalFixtureCoverage,
  validateJsonFormatting,
  validateProtocol,
} from "./validation.mjs";
import {
  loadPreviewArtifacts,
  validatePreviewArtifacts,
  validatePreviewJsonFormatting,
} from "./preview-validation.mjs";
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
  const artifacts = loadProtocolArtifacts();
  const previewArtifacts = loadPreviewArtifacts();
  const artifactsV02 = loadProtocolV02Artifacts();
  const previewArtifactsV02 = loadPreviewV02Artifacts();
  const errors = [
    ...validateProtocol(artifacts),
    ...validateCanonicalFixtureCoverage(artifacts.document),
    ...validateJsonFormatting(),
    ...validatePreviewArtifacts(previewArtifacts),
    ...validatePreviewJsonFormatting(),
    ...validateBrowserContractGeneration(),
    ...validateProtocolV02(artifactsV02),
    ...validateProtocolV02({
      ...artifactsV02,
      document: artifactsV02.edgeDocument,
    }),
    ...validateProtocolV02({
      ...artifactsV02,
      document: artifactsV02.migratedDocument,
    }),
    ...validateProtocolV02({
      ...artifactsV02,
      document: artifactsV02.expiredCountdownDocument,
    }),
    ...validateProtocolV02({
      ...artifactsV02,
      document: artifactsV02.hiddenPurchaseTargetDocument,
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
      `Validated ${relative(protocolRoot, protocolPaths.canonicalFixture)} ` +
        "against Mosaic Protocol 0.1 RC1 and its compatibility manifest; " +
        "validated Protocol and Local Preview 0.1/0.2 schemas, fixtures, " +
        "migrations, and browser contract.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
