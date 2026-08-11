import { environmentMatchesConnectionMode } from "@/features/provider-connections/types/provider-operation-input";
import type {
  ActiveProviderAssignment,
  Application,
  Environment,
  ProviderConnection,
  ProviderHealthStatus,
} from "@/generated/api";

const PROVIDER_CONNECTION_LABELS: Record<
  ProviderConnection["provider"],
  string
> = {
  app_store_connect: "App Store Connect",
  custom: "Custom provider",
  revenuecat: "RevenueCat",
};

export function providerConnectionLabel(
  provider: ProviderConnection["provider"]
): string {
  return PROVIDER_CONNECTION_LABELS[provider];
}

/**
 * App Store Connect maps each Apple subscription group to one Offering holding
 * one Package, so the advanced mapping control is named for the resource the
 * operator actually sees in their own console rather than for the adapter's
 * internal shape.
 */
export function providerOfferingLabel(
  provider: ProviderConnection["provider"] | undefined
): string {
  return provider === "app_store_connect"
    ? "Subscription group"
    : "Package and Offering";
}

export type PurchaseProviderChoice =
  | {
      id: "native:app_store" | "native:google_play";
      kind: "native";
      label: "Google Play Billing" | "StoreKit";
      provider: "app_store" | "google_play";
    }
  | {
      connection: ProviderConnection;
      id: `connection:${string}`;
      kind: "connection";
      label: string;
      provider: ProviderConnection["provider"];
    };

export interface ActiveProviderAssignmentView {
  assignment: ActiveProviderAssignment;
  connection?: ProviderConnection;
}

export interface ActiveProviderScopeView {
  application: Application;
  assignment?: ActiveProviderAssignmentView;
  environment: Environment;
}

export function purchaseProviderChoices(
  application: Application,
  environment: Environment,
  connections: readonly ProviderConnection[]
): PurchaseProviderChoice[] {
  const nativeChoice: PurchaseProviderChoice =
    application.platform === "ios"
      ? {
          id: "native:app_store",
          kind: "native",
          label: "StoreKit",
          provider: "app_store",
        }
      : {
          id: "native:google_play",
          kind: "native",
          label: "Google Play Billing",
          provider: "google_play",
        };
  const connectionChoices = connections
    .filter(
      (connection) =>
        connection.status === "active" &&
        connection.healthStatus === "healthy" &&
        connection.environmentIds.includes(environment.id) &&
        connection.applicationIds.includes(application.id) &&
        environmentMatchesConnectionMode(environment.mode, connection.mode)
    )
    .map(
      (connection) =>
        ({
          connection,
          id: `connection:${connection.id}`,
          kind: "connection",
          label: connection.name,
          provider: connection.provider,
        }) satisfies PurchaseProviderChoice
    );

  return [nativeChoice, ...connectionChoices];
}

export function activeProviderScopes(
  applications: readonly Application[],
  environment: Environment,
  assignments: readonly ActiveProviderAssignment[],
  connections: readonly ProviderConnection[]
): ActiveProviderScopeView[] {
  const assignmentByApplication = new Map(
    assignments
      .filter((assignment) => assignment.environmentId === environment.id)
      .map((assignment) => [
        assignment.applicationId,
        {
          assignment,
          connection: connections.find(
            (connection) => connection.id === assignment.connectionId
          ),
        } satisfies ActiveProviderAssignmentView,
      ])
  );

  return applications.map((application) => ({
    application,
    assignment: assignmentByApplication.get(application.id),
    environment,
  }));
}

export function providerCredentialActions(
  connection: Pick<ProviderConnection, "lastErrorCode" | "status">,
  healthStatus: ProviderHealthStatus
): { reconnect: boolean; rotate: boolean } {
  const recoveryErrors = new Set([
    "credentialExpired",
    "credentialInvalid",
    "permissionDenied",
    "providerUnavailable",
  ]);
  const revoked = connection.status === "revoked";
  return {
    reconnect:
      revoked ||
      healthStatus === "degraded" ||
      healthStatus === "unavailable" ||
      Boolean(
        connection.lastErrorCode && recoveryErrors.has(connection.lastErrorCode)
      ),
    rotate: !revoked,
  };
}
