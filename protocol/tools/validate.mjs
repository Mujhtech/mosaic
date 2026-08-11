import { protocolV03Paths, protocolV03Root } from "./validation-v0.3.mjs";
import { validateBrowserContractGeneration } from "./browser-contract-validation.mjs";
import {
  loadProtocolV03Artifacts,
  validateCanonicalV03Coverage,
  validateRatingAnnouncementVectors,
  validateAccessibilityAnnouncementVectors,
  validateProtocolV03,
  validateV03JsonFormatting,
} from "./validation-v0.3.mjs";
import {
  loadProtocolV04Artifacts,
  validateCanonicalV04Coverage,
  validateMotionFrameVectors,
  validateProtocolV04,
  validateV04AccessibilityAnnouncementVectors,
  validateV04JsonFormatting,
} from "./validation-v0.4.mjs";
import {
  loadPreviewV03Artifacts,
  validatePreviewV03Artifacts,
  validatePreviewV03JsonFormatting,
} from "./preview-validation-v0.3.mjs";
import {
  loadPreviewV04Artifacts,
  validatePreviewV04Artifacts,
  validatePreviewV04JsonFormatting,
} from "./preview-validation-v0.4.mjs";
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
import {
  loadBillingIngestionV1Artifacts,
  validateBillingIngestionV1Artifacts,
  validateBillingIngestionV1JsonFormatting,
} from "./billing-ingestion-validation-v1.mjs";
import {
  loadAuthoritativeEntitlementV1Artifacts,
  validateAuthoritativeEntitlementV1Artifacts,
  validateAuthoritativeEntitlementV1JsonFormatting,
} from "./authoritative-entitlement-validation-v1.mjs";
import {
  loadCustomerAccessTokenV1Artifacts,
  validateCustomerAccessTokenV1Artifacts,
  validateCustomerAccessTokenV1JsonFormatting,
} from "./customer-access-token-validation-v1.mjs";
import {
  loadBillingStateWebhookV1Artifacts,
  validateBillingStateWebhookV1Artifacts,
  validateBillingStateWebhookV1JsonFormatting,
} from "./billing-state-webhook-validation-v1.mjs";
import {
  loadLocaleResolutionV03Artifacts,
  validateLocaleResolutionV03Artifacts,
  validateLocaleResolutionV03JsonFormatting,
} from "./locale-resolution-v0.3.mjs";
import { validateAnalyticsMinimizationProjection } from "./generate-analytics-minimization.mjs";
import { validateRejectionLayers } from "./generate-rejection-layers.mjs";
import { checkGuardVacuity } from "./check-guard-vacuity.mjs";
import {
  loadPhase9CArtifacts,
  validatePhase9CArtifacts,
  validatePhase9CJsonFormatting,
} from "./phase9c-contract-validation.mjs";

try {
  const artifactsV03 = loadProtocolV03Artifacts();
  const artifactsV04 = loadProtocolV04Artifacts();
  const previewArtifactsV03 = loadPreviewV03Artifacts();
  const previewArtifactsV04 = loadPreviewV04Artifacts();
  const localeResolutionArtifactsV03 = loadLocaleResolutionV03Artifacts();
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
  const billingIngestionArtifactsV1 = loadBillingIngestionV1Artifacts();
  const authoritativeEntitlementArtifactsV1 =
    loadAuthoritativeEntitlementV1Artifacts();
  const customerAccessTokenArtifactsV1 = loadCustomerAccessTokenV1Artifacts();
  const billingStateWebhookArtifactsV1 = loadBillingStateWebhookV1Artifacts();
  const authoritativeEntitlementArtifactsV2 = loadPhase9CArtifacts(
    "authoritativeEntitlementV2",
  );
  const billingMigrationOperationsArtifactsV1 = loadPhase9CArtifacts(
    "billingMigrationOperationsV1",
  );
  const billingStateWebhookArtifactsV2 = loadPhase9CArtifacts(
    "billingStateWebhookV2",
  );
  const errors = [
    ...validateBrowserContractGeneration(),
    ...validateProtocolV03(artifactsV03),
    ...validateProtocolV03({
      ...artifactsV03,
      document: artifactsV03.edgeDocument,
    }),
    ...validateProtocolV03({
      ...artifactsV03,
      document: artifactsV03.expiredCountdownDocument,
    }),
    ...validateProtocolV03({
      ...artifactsV03,
      document: artifactsV03.hiddenPurchaseTargetDocument,
    }),
    ...validateProtocolV03({
      ...artifactsV03,
      document: artifactsV03.navigationOnlyDocument,
    }),
    ...validateCanonicalV03Coverage(artifactsV03.document),
    ...validateRatingAnnouncementVectors(),
    ...validateAccessibilityAnnouncementVectors(),
    ...validateV03JsonFormatting(),
    ...validateProtocolV04(artifactsV04),
    ...validateProtocolV04({
      ...artifactsV04,
      document: artifactsV04.edgeDocument,
    }),
    ...validateProtocolV04({
      ...artifactsV04,
      document: artifactsV04.expiredCountdownDocument,
    }),
    ...validateProtocolV04({
      ...artifactsV04,
      document: artifactsV04.hiddenPurchaseTargetDocument,
    }),
    ...validateProtocolV04({
      ...artifactsV04,
      document: artifactsV04.navigationOnlyDocument,
    }),
    ...validateProtocolV04({
      ...artifactsV04,
      document: artifactsV04.screenRoundTripDocument,
    }),
    ...validateCanonicalV03Coverage(artifactsV04.document),
    ...validateCanonicalV04Coverage(artifactsV04.document),
    ...validateMotionFrameVectors(),
    ...validateV04AccessibilityAnnouncementVectors(),
    ...validateV04JsonFormatting(),
    ...validateLocaleResolutionV03Artifacts(localeResolutionArtifactsV03),
    ...validateLocaleResolutionV03JsonFormatting(),
    ...validatePreviewV03Artifacts(previewArtifactsV03),
    ...validatePreviewV03JsonFormatting(),
    ...validatePreviewV04Artifacts(previewArtifactsV04),
    ...validatePreviewV04JsonFormatting(),
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
    ...validateBillingIngestionV1Artifacts(billingIngestionArtifactsV1),
    ...validateBillingIngestionV1JsonFormatting(),
    ...validateAuthoritativeEntitlementV1Artifacts(
      authoritativeEntitlementArtifactsV1,
    ),
    ...validateAuthoritativeEntitlementV1JsonFormatting(),
    ...validateCustomerAccessTokenV1Artifacts(customerAccessTokenArtifactsV1),
    ...validateCustomerAccessTokenV1JsonFormatting(),
    ...validateBillingStateWebhookV1Artifacts(billingStateWebhookArtifactsV1),
    ...validateBillingStateWebhookV1JsonFormatting(),
    ...validatePhase9CArtifacts(authoritativeEntitlementArtifactsV2),
    ...validatePhase9CArtifacts(billingMigrationOperationsArtifactsV1),
    ...validatePhase9CArtifacts(billingStateWebhookArtifactsV2),
    ...validatePhase9CJsonFormatting(),
    ...validateAnalyticsMinimizationProjection(),
    ...validateRejectionLayers(),
    ...checkGuardVacuity(),
  ];

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `Validated ${relative(protocolV03Root, protocolV03Paths.canonicalFixture)} ` +
        "against the Mosaic Protocol 0.3 schema and compatibility manifest; " +
        "validated Local Preview 0.3 fixtures, Configuration Delivery v1, " +
        "Commerce Provider Contracts v1/v2, Commerce Configurations v1/v2, " +
        "Placement Decision v1, Configuration Delivery v2, Analytics Event " +
        "v1/v2, Experiment Assignment v1, Configuration Delivery v3, Billing " +
        "Ingestion v1 (draft), Authoritative Entitlement v1 (draft), Customer " +
        "Access Token v1 (draft), Billing State Webhook v1 (draft), Billing " +
        "Migration Operations v1 (draft), Authoritative Entitlement v2 " +
        "(draft), Billing State Webhook v2 (draft), Paywall Protocol 0.4 " +
        "(draft) with its motion frame vectors, Local Preview 0.4 (draft), " +
        "and the browser contract.",
    );
  }
} catch (error) {
  // A typed refusal already says everything useful, and a missing artifact names
  // its own path. Anything else is a bug in the tools, and a bug reported as one
  // line of message is a bug that takes an afternoon to locate.
  console.error(isExpectedValidationFailure(error) ? error.message : (error?.stack ?? error));
  process.exitCode = 1;
}

function isExpectedValidationFailure(error) {
  if (!(error instanceof Error)) return false;
  // Typed refusals raised deliberately by the validators themselves.
  if (error.name === "DecisionEvaluationError") return true;
  // A committed artifact that is missing or unreadable: the message carries the
  // path, which is the whole diagnosis.
  return typeof error.code === "string" && ["ENOENT", "EACCES", "EISDIR"].includes(error.code);
}
