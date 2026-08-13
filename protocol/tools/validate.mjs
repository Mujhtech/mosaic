import { validateBrowserContractGeneration } from "./browser-contract-validation.mjs";
import {
  paywallRulesRoot,
  validateCanonicalCoverage,
  validatePaywallRulesJsonFormatting,
  validateRatingAnnouncementVectors,
} from "./paywall-document-rules.mjs";
import {
  loadProtocolV04Artifacts,
  protocolV04Paths,
  validateCanonicalV04Coverage,
  validateMotionFrameVectors,
  validateProtocolV04,
  validateV04AccessibilityAnnouncementVectors,
  validateV04JsonFormatting,
} from "./validation-v0.4.mjs";
import {
  loadPreviewV04Artifacts,
  validatePreviewV04Artifacts,
  validatePreviewV04JsonFormatting,
} from "./preview-validation-v0.4.mjs";
import { relative } from "node:path";
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
  loadCustomerAccessTokenV1Artifacts,
  validateCustomerAccessTokenV1Artifacts,
  validateCustomerAccessTokenV1JsonFormatting,
} from "./customer-access-token-validation-v1.mjs";
import {
  loadLocaleResolutionArtifacts,
  validateLocaleResolutionArtifacts,
  validateLocaleResolutionJsonFormatting,
} from "./locale-resolution.mjs";
import { validateAnalyticsMinimizationProjection } from "./generate-analytics-minimization.mjs";
import { validateRejectionLayers } from "./generate-rejection-layers.mjs";
import { checkGuardVacuity } from "./check-guard-vacuity.mjs";
import {
  loadPhase9CArtifacts,
  validatePhase9CArtifacts,
  validatePhase9CJsonFormatting,
} from "./phase9c-contract-validation.mjs";

try {
  const artifactsV04 = loadProtocolV04Artifacts();
  const previewArtifactsV04 = loadPreviewV04Artifacts();
  const localeResolutionArtifacts = loadLocaleResolutionArtifacts();
  const commerceProviderArtifactsV2 = loadCommerceProviderV2Artifacts();
  const commerceConfigurationArtifactsV2 =
    loadCommerceConfigurationV2Artifacts();
  const decisionArtifactsV1 = loadDecisionV1Artifacts();
  const experimentAssignmentArtifactsV1 = loadExperimentAssignmentV1Artifacts();
  const deliveryArtifactsV3 = loadDeliveryV3Artifacts();
  const analyticsEventArtifactsV2 = loadAnalyticsEventV2Artifacts();
  const billingIngestionArtifactsV1 = loadBillingIngestionV1Artifacts();
  const customerAccessTokenArtifactsV1 = loadCustomerAccessTokenV1Artifacts();
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
    ...validateCanonicalCoverage(artifactsV04.document),
    ...validateCanonicalV04Coverage(artifactsV04.document),
    ...validateRatingAnnouncementVectors(),
    ...validatePaywallRulesJsonFormatting(),
    ...validateMotionFrameVectors(),
    ...validateV04AccessibilityAnnouncementVectors(),
    ...validateV04JsonFormatting(),
    ...validateLocaleResolutionArtifacts(localeResolutionArtifacts),
    ...validateLocaleResolutionJsonFormatting(),
    ...validatePreviewV04Artifacts(previewArtifactsV04),
    ...validatePreviewV04JsonFormatting(),
    ...validateCommerceProviderV2Artifacts(commerceProviderArtifactsV2),
    ...validateCommerceProviderV2JsonFormatting(),
    ...validateCommerceConfigurationV2Artifacts(
      commerceConfigurationArtifactsV2,
    ),
    ...validateCommerceConfigurationV2JsonFormatting(),
    ...validateDecisionV1Artifacts(decisionArtifactsV1),
    ...validateDecisionV1JsonFormatting(),
    ...validateExperimentAssignmentV1Artifacts(experimentAssignmentArtifactsV1),
    ...validateExperimentAssignmentV1JsonFormatting(),
    ...validateDeliveryV3Artifacts(deliveryArtifactsV3),
    ...validateDeliveryV3JsonFormatting(),
    ...validateAnalyticsEventV2Artifacts(analyticsEventArtifactsV2),
    ...validateAnalyticsEventV2JsonFormatting(),
    ...validateBillingIngestionV1Artifacts(billingIngestionArtifactsV1),
    ...validateBillingIngestionV1JsonFormatting(),
    ...validateCustomerAccessTokenV1Artifacts(customerAccessTokenArtifactsV1),
    ...validateCustomerAccessTokenV1JsonFormatting(),
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
      `Validated ${relative(paywallRulesRoot, protocolV04Paths.canonicalFixture)} ` +
        "against the Mosaic Protocol 0.4 schema and compatibility manifest; " +
        "validated Local Preview 0.4 fixtures, " +
        "Commerce Provider Contract v2, Commerce Configuration v2, " +
        "Placement Decision v1, Analytics Event " +
        "v2, Experiment Assignment v1, Configuration Delivery v3, Billing " +
        "Ingestion v1 (draft), Customer Access Token v1 (draft), Billing " +
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
