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
import { relative } from "node:path";

try {
  const artifacts = loadProtocolArtifacts();
  const previewArtifacts = loadPreviewArtifacts();
  const errors = [
    ...validateProtocol(artifacts),
    ...validateCanonicalFixtureCoverage(artifacts.document),
    ...validateJsonFormatting(),
    ...validatePreviewArtifacts(previewArtifacts),
    ...validatePreviewJsonFormatting(),
    ...validateBrowserContractGeneration(),
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
        "validated Local Preview 0.1 schemas, fixtures, and browser contract.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
