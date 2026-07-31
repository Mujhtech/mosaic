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
import {
  loadDeliveryV1Artifacts,
  validateDeliveryV1Artifacts,
  validateDeliveryV1JsonFormatting,
} from "./delivery-validation-v1.mjs";
import {
  loadCommerceProviderV1Artifacts,
  validateCommerceProviderV1Artifacts,
  validateCommerceProviderV1JsonFormatting,
} from "./commerce-provider-validation-v1.mjs";
import {
  loadCommerceConfigurationV1Artifacts,
  validateCommerceConfigurationV1Artifacts,
  validateCommerceConfigurationV1JsonFormatting,
} from "./commerce-configuration-validation-v1.mjs";
import {
  loadCommerceProviderV2Artifacts,
  validateCommerceProviderV2Artifacts,
  validateCommerceProviderV2JsonFormatting,
} from "./commerce-provider-validation-v2.mjs";
import {
  loadCommerceConfigurationV2Artifacts,
  validateCommerceConfigurationV2Artifacts,
  validateCommerceConfigurationV2JsonFormatting,
} from "./commerce-configuration-validation-v2.mjs";
import {
  loadDecisionV1Artifacts,
  validateDecisionV1Artifacts,
  validateDecisionV1JsonFormatting,
} from "./placement-decision-validation-v1.mjs";
import {
  loadDeliveryV2Artifacts,
  validateDeliveryV2Artifacts,
  validateDeliveryV2JsonFormatting,
} from "./delivery-validation-v2.mjs";
import {
  loadAnalyticsEventV1Artifacts,
  validateAnalyticsEventV1Artifacts,
  validateAnalyticsEventV1JsonFormatting,
} from "./analytics-event-validation-v1.mjs";
import {
  loadExperimentAssignmentV1Artifacts,
  validateExperimentAssignmentV1Artifacts,
  validateExperimentAssignmentV1JsonFormatting,
} from "./experiment-assignment-validation-v1.mjs";
import {
  loadDeliveryV3Artifacts,
  validateDeliveryV3Artifacts,
  validateDeliveryV3JsonFormatting,
} from "./delivery-validation-v3.mjs";
import {
  loadAnalyticsEventV2Artifacts,
  validateAnalyticsEventV2Artifacts,
  validateAnalyticsEventV2JsonFormatting,
} from "./analytics-event-validation-v2.mjs";
import { validateAnalyticsMinimizationProjection } from "./generate-analytics-minimization.mjs";
import { validateRejectionLayers } from "./generate-rejection-layers.mjs";

try {
  const artifactsV02 = loadProtocolV02Artifacts();
  const previewArtifactsV02 = loadPreviewV02Artifacts();
  const deliveryArtifactsV1 = loadDeliveryV1Artifacts();
  const commerceProviderArtifactsV1 = loadCommerceProviderV1Artifacts();
  const commerceConfigurationArtifactsV1 =
    loadCommerceConfigurationV1Artifacts();
  const commerceProviderArtifactsV2 = loadCommerceProviderV2Artifacts();
  const commerceConfigurationArtifactsV2 =
    loadCommerceConfigurationV2Artifacts();
  const decisionArtifactsV1 = loadDecisionV1Artifacts();
  const deliveryArtifactsV2 = loadDeliveryV2Artifacts();
  const analyticsEventArtifactsV1 = loadAnalyticsEventV1Artifacts();
  const experimentAssignmentArtifactsV1 = loadExperimentAssignmentV1Artifacts();
  const deliveryArtifactsV3 = loadDeliveryV3Artifacts();
  const analyticsEventArtifactsV2 = loadAnalyticsEventV2Artifacts();
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
    ...validateDeliveryV1Artifacts(deliveryArtifactsV1),
    ...validateDeliveryV1JsonFormatting(),
    ...validateCommerceProviderV1Artifacts(commerceProviderArtifactsV1),
    ...validateCommerceProviderV1JsonFormatting(),
    ...validateCommerceConfigurationV1Artifacts(
      commerceConfigurationArtifactsV1,
    ),
    ...validateCommerceConfigurationV1JsonFormatting(),
    ...validateCommerceProviderV2Artifacts(commerceProviderArtifactsV2),
    ...validateCommerceProviderV2JsonFormatting(),
    ...validateCommerceConfigurationV2Artifacts(
      commerceConfigurationArtifactsV2,
    ),
    ...validateCommerceConfigurationV2JsonFormatting(),
    ...validateDecisionV1Artifacts(decisionArtifactsV1),
    ...validateDecisionV1JsonFormatting(),
    ...validateDeliveryV2Artifacts(deliveryArtifactsV2),
    ...validateDeliveryV2JsonFormatting(),
    ...validateAnalyticsEventV1Artifacts(analyticsEventArtifactsV1),
    ...validateAnalyticsEventV1JsonFormatting(),
    ...validateExperimentAssignmentV1Artifacts(experimentAssignmentArtifactsV1),
    ...validateExperimentAssignmentV1JsonFormatting(),
    ...validateDeliveryV3Artifacts(deliveryArtifactsV3),
    ...validateDeliveryV3JsonFormatting(),
    ...validateAnalyticsEventV2Artifacts(analyticsEventArtifactsV2),
    ...validateAnalyticsEventV2JsonFormatting(),
    ...validateAnalyticsMinimizationProjection(),
    ...validateRejectionLayers(),
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
        "validated Local Preview 0.2 fixtures, Configuration Delivery v1, " +
        "Commerce Provider Contracts v1/v2, Commerce Configurations v1/v2, " +
        "Placement Decision v1, Configuration Delivery v2, Analytics Event " +
        "v1/v2, Experiment Assignment v1, Configuration Delivery v3, and the browser contract.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
