import { type QueryClient, useMutation } from "@tanstack/react-query";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useId,
  useState,
} from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/features/billing-ledger/components/billing-chrome";
import { MigrationImpactReviewAction } from "@/features/billing-migrations/components/migration-impact-review-action";
import {
  createMigrationCommandKey,
  migrationLifecycleMutationOptions,
} from "@/features/billing-migrations/mutations/migration-mutations";
import {
  canRunMigrationCommand,
  type MigrationCommandCapability,
  type MigrationCompletionInspection,
  type MigrationProgramView,
  migrationCompletionBlockers,
} from "@/features/billing-migrations/types/migration-operations";
import type {
  BillingMigrationApproval,
  BillingMigrationAuthorityExecution,
  BillingMigrationCase,
  BillingMigrationCheckpoint,
  BillingMigrationCompletionReport,
  BillingMigrationCredentialRemoval,
  BillingMigrationDigestSet,
  BillingMigrationLegalHold,
  BillingMigrationLegalHoldProposal,
  BillingMigrationProposal,
  BillingMigrationRepairExecution,
  BillingMigrationRepairPreview,
  BillingMigrationRepairPreviewRequest,
  BillingMigrationRollbackReadinessAssessment,
  BillingMigrationStabilizationObservation,
  BillingMigrationWebhookRedelivery,
} from "@/generated/api";
import { describeApiError } from "@/lib/api/errors";

type LifecycleRecord =
  | BillingMigrationApproval
  | BillingMigrationAuthorityExecution
  | BillingMigrationCase
  | BillingMigrationCheckpoint
  | BillingMigrationCompletionReport
  | BillingMigrationCredentialRemoval
  | BillingMigrationLegalHold
  | BillingMigrationLegalHoldProposal
  | BillingMigrationProposal
  | BillingMigrationRepairExecution
  | BillingMigrationRepairPreview
  | BillingMigrationRollbackReadinessAssessment
  | BillingMigrationStabilizationObservation
  | BillingMigrationWebhookRedelivery;
type RepairKind = BillingMigrationRepairPreviewRequest["repairKind"];

interface LifecycleData {
  approvals: BillingMigrationApproval[];
  cases: BillingMigrationCase[];
  checkpoints: BillingMigrationCheckpoint[];
  completion: MigrationCompletionInspection;
  executions: BillingMigrationAuthorityExecution[];
  holdProposals: BillingMigrationLegalHoldProposal[];
  holds: BillingMigrationLegalHold[];
  observations: BillingMigrationStabilizationObservation[];
  proposals: BillingMigrationProposal[];
  removals: BillingMigrationCredentialRemoval[];
  repairExecutions: BillingMigrationRepairExecution[];
  repairPreviews: BillingMigrationRepairPreview[];
  reports: BillingMigrationCompletionReport[];
  rollbackAssessments: BillingMigrationRollbackReadinessAssessment[];
  webhookRedeliveries: BillingMigrationWebhookRedelivery[];
}
type CommandName =
  | "propose_cutover"
  | "approve_cutover"
  | "checkpoint"
  | "execute_cutover"
  | "observe_stabilization"
  | "propose_rollback"
  | "approve_rollback"
  | "execute_rollback"
  | "preview_repair"
  | "execute_repair"
  | "redeliver_webhook"
  | "remove_credential"
  | "propose_legal_hold"
  | "approve_legal_hold"
  | "complete";

const commandCapability: Record<CommandName, MigrationCommandCapability> = {
  approve_cutover: "approve-cutover",
  approve_legal_hold: "manage-legal-hold",
  approve_rollback: "execute-rollback",
  checkpoint: "execute-cutover",
  complete: "complete-migration",
  execute_cutover: "execute-cutover",
  execute_repair: "execute-repair",
  execute_rollback: "execute-rollback",
  observe_stabilization: "execute-rollback",
  preview_repair: "execute-repair",
  propose_cutover: "propose-cutover",
  propose_legal_hold: "manage-legal-hold",
  propose_rollback: "execute-rollback",
  redeliver_webhook: "execute-repair",
  remove_credential: "remove-credential",
};

const digestNames = [
  "scope",
  "manifest",
  "mapping",
  "policy",
  "evidence",
  "readiness",
  "finalWatermark",
  "applicationVersion",
] as const;

const emptyDigests = Object.fromEntries(
  digestNames.map((name) => [name, ""])
) as BillingMigrationDigestSet;

const impact: Record<CommandName, string> = {
  approve_cutover:
    "Attests to another human's production proposal; it does not change authority by itself.",
  approve_legal_hold:
    "Applies an approved retention hold command and changes deletion eligibility.",
  approve_rollback:
    "Attests to another human's rollback proposal; execution creates a newer source-authority epoch.",
  checkpoint:
    "Freezes the approved cohort and rollback baseline; stale evidence invalidates it.",
  complete:
    "Closes stabilization only when the server confirms every completion prerequisite.",
  execute_cutover:
    "Atomically changes access authority from the source to Mosaic and increments the authority epoch.",
  execute_repair:
    "Executes only the allowlisted, bounded repair represented by the unexpired preview.",
  execute_rollback:
    "Creates a newer source-rollback authority epoch; it never deletes Mosaic evidence.",
  observe_stabilization:
    "Records server-derived health evidence; caller-supplied metrics are not accepted.",
  preview_repair:
    "Creates a bounded impact preview. It cannot edit facts, snapshots, or access directly.",
  propose_cutover:
    "Creates an expiring proposal bound to the exact evidence digests; authority is unchanged.",
  propose_legal_hold:
    "Proposes changing evidence retention; production requires a distinct approver.",
  propose_rollback:
    "Creates an expiring rollback proposal bound to checkpoint and prerequisite digests.",
  redeliver_webhook:
    "Redelivers one stored event to one stored destination without accepting payloads or secrets.",
  remove_credential:
    "Irreversibly destroys migration credential material and may make rollback unhealthy.",
};

/**
 * Every free-text value the command builder binds a command to.
 *
 * They travel together because no command is judged by one of them alone: what
 * must be present, and what the command then means, is decided from the whole
 * set at once.
 */
interface CommandInputs {
  approvalDigest: string;
  authorityDigest: string;
  caseDigest: string;
  digests: BillingMigrationDigestSet;
  expectedDigest: string;
  expiresAt: string;
  prerequisiteDigest: string;
  reason: string;
  referenceId: string;
  scopeKind: string;
  secondaryId: string;
}

interface CommandInputSetters {
  setApprovalDigest: (value: string) => void;
  setAuthorityDigest: (value: string) => void;
  setCaseDigest: (value: string) => void;
  setDigests: Dispatch<SetStateAction<BillingMigrationDigestSet>>;
  setExpectedDigest: (value: string) => void;
  setExpiresAt: (value: string) => void;
  setPrerequisiteDigest: (value: string) => void;
  setReason: (value: string) => void;
  setReferenceId: (value: string) => void;
  setScopeKind: (value: string) => void;
  setSecondaryId: (value: string) => void;
}

function repairKind(value: string): RepairKind | undefined {
  const values: RepairKind[] = [
    "provider_revalidate",
    "projection_replay",
    "attach_proven_alias",
    "replace_mapping_set",
    "retry_quarantined_record",
  ];
  return values.find((candidate) => candidate === value);
}

function requireRepairKind(value: string): RepairKind {
  const parsed = repairKind(value);
  if (!parsed) {
    throw new Error("Select a supported repair kind.");
  }
  return parsed;
}

/**
 * Whether every reference and digest this command is bound to has been
 * supplied. A command is a compare-and-swap against reviewed server state, so a
 * missing binding is refused here rather than sent and rejected.
 */
function hasBoundInputs(name: CommandName, values: CommandInputs) {
  const {
    approvalDigest,
    authorityDigest,
    caseDigest,
    digests,
    expectedDigest,
    prerequisiteDigest,
    referenceId,
    secondaryId,
  } = values;
  const allDigestsPresent = digestNames.every((digestName) =>
    digests[digestName].trim()
  );
  switch (name) {
    case "propose_cutover":
      return allDigestsPresent;
    case "approve_cutover":
    case "approve_rollback":
      return Boolean(referenceId);
    case "checkpoint":
      return Boolean(
        referenceId && expectedDigest && approvalDigest && allDigestsPresent
      );
    case "execute_cutover":
      return Boolean(
        referenceId && secondaryId && approvalDigest && allDigestsPresent
      );
    case "observe_stabilization":
      return Boolean(digests.policy);
    case "propose_rollback":
      return Boolean(
        referenceId && expectedDigest && authorityDigest && prerequisiteDigest
      );
    case "execute_rollback":
      return Boolean(
        referenceId &&
          secondaryId &&
          expectedDigest &&
          authorityDigest &&
          prerequisiteDigest &&
          approvalDigest
      );
    case "preview_repair":
      return Boolean(
        referenceId &&
          secondaryId &&
          expectedDigest &&
          caseDigest &&
          digests.policy &&
          digests.scope
      );
    case "execute_repair":
      return Boolean(
        referenceId &&
          expectedDigest &&
          caseDigest &&
          digests.policy &&
          digests.scope
      );
    case "redeliver_webhook":
      return Boolean(referenceId && secondaryId && expectedDigest);
    case "remove_credential":
      return true;
    case "propose_legal_hold":
      return Boolean(referenceId);
    case "approve_legal_hold":
      return Boolean(referenceId && expectedDigest);
    case "complete":
      return Boolean(authorityDigest && digests.policy && expectedDigest);
    default: {
      const unhandled: never = name;
      throw new Error(`Unhandled name: ${JSON.stringify(unhandled)}`);
    }
  }
}

function commandNeedsReason(name: CommandName) {
  return ![
    "approve_cutover",
    "approve_rollback",
    "checkpoint",
    "execute_repair",
    "approve_legal_hold",
    "complete",
    "observe_stabilization",
  ].includes(name);
}

/** The one specific thing still missing, or null when the command may run. */
function commandDisabledReason({
  acknowledged,
  boundInputsPresent,
  capability,
  completionBlockers,
  expiresAt,
  granted,
  name,
  needsReason,
  organizationRole,
  reason,
}: {
  acknowledged: boolean;
  boundInputsPresent: boolean;
  capability: MigrationCommandCapability;
  completionBlockers: string[];
  expiresAt: string;
  granted: boolean;
  name: CommandName;
  needsReason: boolean;
  organizationRole?: string;
  reason: string;
}) {
  if (granted) {
    if (needsReason && reason.trim().length < 8) {
      return "Enter a specific operational reason of at least 8 characters.";
    }
    if (boundInputsPresent) {
      if (name === "complete" && completionBlockers.length > 0) {
        return `Completion is blocked: ${completionBlockers.join(", ")}`;
      }
      if (
        [
          "propose_cutover",
          "propose_rollback",
          "preview_repair",
          "propose_legal_hold",
        ].includes(name) &&
        !expiresAt
      ) {
        return "Enter the explicit approval or preview expiry time.";
      }
      if (name === "remove_credential" && !acknowledged) {
        return "Acknowledge that credential removal is irreversible and can prevent rollback.";
      }
      return null;
    }
    return "Enter every reference and expected digest required to bind this command to reviewed server state.";
  }
  return `The server has not granted ${capability}. Organization role ${organizationRole ?? "unknown"} is explanatory only.`;
}

function lifecycleFacts(
  name: CommandName,
  values: CommandInputs,
  program: MigrationProgramView["program"]
) {
  return [
    {
      label: "Program state",
      value: `${program.state} · version ${program.stateVersion}`,
    },
    {
      label: "Authority epoch",
      value: String(
        program.authorityEpochAfter ?? program.authorityEpochBefore
      ),
    },
    {
      label: "Primary reference",
      value: values.referenceId || "Not supplied",
    },
    {
      label: "Expected digest",
      value: values.expectedDigest || "See bound digest fields",
    },
    { label: "Authority consequence", value: impact[name] },
  ];
}

/**
 * The exact wire command for one lifecycle name, bound to the reviewed state
 * version and digests. Each branch names its own required bindings; nothing is
 * defaulted or inferred, because every one of these commands is a
 * compare-and-swap the server will refuse if the binding is wrong.
 */
function buildLifecycleCommand(
  name: CommandName,
  values: CommandInputs,
  program: MigrationProgramView["program"]
) {
  const {
    approvalDigest,
    authorityDigest,
    caseDigest,
    digests,
    expectedDigest,
    expiresAt,
    prerequisiteDigest,
    reason,
    referenceId,
    scopeKind,
    secondaryId,
  } = values;
  const expectedStateVersion = program.stateVersion;
  const expiration = expiresAt ? new Date(expiresAt).toISOString() : "";
  const scope = {
    applications: program.scope.applications,
    environmentId: program.scope.environmentId,
  };
  const approvalCommand = {
    body: { expectedStateVersion },
    kind: "approve_proposal" as const,
    proposalId: referenceId,
  };
  const selectedRepairKind =
    name === "preview_repair"
      ? requireRepairKind(secondaryId)
      : "provider_revalidate";
  switch (name) {
    case "propose_cutover":
      return {
        kind: name,
        body: {
          expectedDigests: digests,
          expectedStateVersion,
          expiresAt: expiration,
          reason: reason.trim(),
        },
      };
    case "approve_cutover":
    case "approve_rollback":
      return approvalCommand;
    case "checkpoint":
      return {
        kind: "create_checkpoint" as const,
        body: {
          approvalDigest,
          approvalId: referenceId,
          cohortDigest: expectedDigest,
          expectedDigests: digests,
          expectedStateVersion,
        },
      };
    case "execute_cutover":
      return {
        kind: name,
        body: {
          approvalDigest,
          approvalId: secondaryId,
          checkpointId: referenceId,
          expectedAuthorityEpoch: program.authorityEpochBefore,
          expectedDigests: digests,
          expectedStateVersion,
          reason: reason.trim(),
          scope,
        },
      };
    case "observe_stabilization":
      return {
        kind: name,
        body: {
          expectedAuthorityEpoch:
            program.authorityEpochAfter ?? program.authorityEpochBefore,
          expectedPolicyDigest: digests.policy,
          expectedStateVersion,
        },
      };
    case "propose_rollback":
      return {
        kind: name,
        body: {
          checkpointId: referenceId,
          expectedAuthorityDigest: authorityDigest,
          expectedCheckpointDigest: expectedDigest,
          expectedRollbackPrerequisitesDigest: prerequisiteDigest,
          expectedStateVersion,
          expiresAt: expiration,
          reason: reason.trim(),
        },
      };
    case "execute_rollback":
      return {
        kind: name,
        body: {
          approvalId: secondaryId,
          checkpointId: referenceId,
          expectedApprovalDigest: approvalDigest,
          expectedAuthorityDigest: authorityDigest,
          expectedAuthorityEpoch:
            program.authorityEpochAfter ?? program.authorityEpochBefore,
          expectedCheckpointDigest: expectedDigest,
          expectedRollbackPrerequisitesDigest: prerequisiteDigest,
          expectedStateVersion,
          reason: reason.trim(),
          scope,
        },
      };
    case "preview_repair":
      return {
        kind: name,
        body: {
          caseId: referenceId,
          expectedCaseDigest: caseDigest,
          expectedPolicyDigest: digests.policy,
          expectedScopeDigest: digests.scope,
          expectedStateVersion,
          expiresAt: expiration,
          reason: reason.trim(),
          repairKind: selectedRepairKind,
          scopeKind,
          scopeReferences: expectedDigest
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        },
      };
    case "execute_repair":
      return {
        kind: name,
        body: {
          expectedCaseDigest: caseDigest,
          expectedPolicyDigest: digests.policy,
          expectedPreviewDigest: expectedDigest,
          expectedScopeDigest: digests.scope,
          expectedStateVersion,
          previewId: referenceId,
        },
      };
    case "redeliver_webhook":
      return {
        kind: name,
        body: {
          destinationId: secondaryId,
          eventId: referenceId,
          expectedEventDigest: expectedDigest,
          expectedStateVersion,
          reason: reason.trim(),
        },
      };
    case "remove_credential":
      return {
        kind: name,
        body: {
          expectedStateVersion,
          irreversibleAcknowledged: true as const,
          reason: reason.trim(),
        },
      };
    case "propose_legal_hold":
      return {
        kind: name,
        body: {
          command:
            secondaryId === "release" ? ("release" as const) : ("set" as const),
          expiresAt: expiration,
          externalComplianceReference: referenceId,
          reason: reason.trim(),
        },
      };
    case "approve_legal_hold":
      return {
        kind: name,
        proposalId: referenceId,
        body: { expectedProposalDigest: expectedDigest },
      };
    case "complete":
      return {
        kind: name,
        body: {
          expectedAuthorityDigest: authorityDigest,
          expectedPolicyDigest: digests.policy,
          expectedStabilityEvidenceDigest: expectedDigest,
          expectedStateVersion,
        },
      };
    default: {
      const unhandled: never = name;
      throw new Error(`Unhandled name: ${JSON.stringify(unhandled)}`);
    }
  }
}

function timelineRecord(record: LifecycleRecord) {
  if ("approvalId" in record) {
    return {
      id: record.approvalId,
      title: `${record.command} approval`,
      time: record.approvedAt,
    };
  }
  if ("classification" in record) {
    return {
      id: record.caseId,
      reason: record.reason,
      status: record.status,
      title: `${record.classification} reconciliation case`,
      time: record.updatedAt,
    };
  }
  if ("checkpointId" in record) {
    return {
      id: record.checkpointId,
      title: "migration checkpoint",
      time: record.createdAt,
    };
  }
  if ("executionId" in record && "command" in record) {
    return {
      id: record.executionId,
      status: record.state,
      title: `${record.command} authority execution`,
      time: record.executedAt,
    };
  }
  if ("holdId" in record) {
    return {
      id: record.holdId,
      reason: record.reason,
      title: `${record.command} legal hold`,
      time: record.commandedAt,
    };
  }
  if ("observationId" in record && "metrics" in record) {
    return {
      id: record.observationId,
      status: record.healthy ? "healthy" : "breached",
      title: "stabilization observation",
      time: record.observedAt,
    };
  }
  if ("removalId" in record) {
    return {
      id: record.removalId,
      reason: record.reason,
      title: "credential removal",
      time: record.removedAt,
    };
  }
  if ("previewId" in record && "repairKind" in record) {
    return {
      id: record.previewId,
      reason: record.reason,
      title: `${record.repairKind.replaceAll("_", " ")} preview`,
      time: record.createdAt,
    };
  }
  if ("executionId" in record) {
    return {
      id: record.executionId,
      status:
        record.executionStatus === "completed" ? record.result : "pending",
      title: "repair execution",
      time:
        record.executionStatus === "completed"
          ? record.executedAt
          : record.reservedAt,
    };
  }
  if ("reportId" in record) {
    return {
      id: record.reportId,
      title: "migration completion",
      time: record.completedAt,
    };
  }
  if ("assessmentId" in record) {
    return {
      id: record.assessmentId,
      status: record.ready ? "ready" : "blocked",
      title: "rollback readiness assessment",
      time: record.assessedAt,
    };
  }
  if ("redeliveryId" in record) {
    return {
      id: record.redeliveryId,
      reason: record.reason,
      title: "webhook redelivery",
      time: record.createdAt,
    };
  }
  if ("externalComplianceReference" in record) {
    return {
      id: record.proposalId,
      reason: record.reason,
      status: record.status,
      title: `${record.command} legal hold proposal`,
      time: record.proposedAt,
    };
  }
  return {
    id: record.proposalId,
    reason: record.reason,
    status: record.status,
    title: `${record.command} proposal`,
    time: record.proposedAt,
  };
}

function Timeline({ records }: { records: LifecycleRecord[] }) {
  if (records.length === 0) {
    return <p className="text-muted-foreground text-sm">No records yet.</p>;
  }
  return (
    <ul className="divide-y">
      {records.map((record) => {
        const item = timelineRecord(record);
        return (
          <li
            className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"
            key={item.id}
          >
            <div className="min-w-0">
              <p className="font-medium">{item.title}</p>
              <p className="break-all text-muted-foreground text-xs">
                {item.id} · {new Date(item.time).toLocaleString()}
              </p>
              {item.reason ? <p className="mt-1">{item.reason}</p> : null}
            </div>
            <StatusPill
              label={item.status ?? "recorded"}
              tone={
                item.status === "failed" ||
                item.status === "blocked" ||
                item.status === "breached"
                  ? "negative"
                  : "neutral"
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

export function MigrationLifecycleOperations({
  data,
  detail,
  organizationRole,
  projectId,
  programId,
  queryClient,
}: {
  data: LifecycleData | undefined;
  detail: MigrationProgramView;
  organizationRole?: string;
  projectId: string;
  programId: string;
  queryClient: QueryClient;
}) {
  const fieldIds = useId();
  const { program } = detail;
  const mutation = useMutation(
    migrationLifecycleMutationOptions(projectId, programId, queryClient)
  );
  const [name, setName] = useState<CommandName>("propose_cutover");
  const [reason, setReason] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [secondaryId, setSecondaryId] = useState("");
  const [expectedDigest, setExpectedDigest] = useState("");
  const [authorityDigest, setAuthorityDigest] = useState("");
  const [prerequisiteDigest, setPrerequisiteDigest] = useState("");
  const [approvalDigest, setApprovalDigest] = useState("");
  const [caseDigest, setCaseDigest] = useState("");
  const [scopeKind, setScopeKind] = useState("case");
  const [digests, setDigests] =
    useState<BillingMigrationDigestSet>(emptyDigests);
  const [acknowledged, setAcknowledged] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const commandOptions = Object.keys(commandCapability).map((item) => ({
    label: item.replaceAll("_", " "),
    value: item,
  }));
  const capability = commandCapability[name];
  const completion = data?.completion;
  // A failed inspection blocks completion exactly as an unsatisfied
  // prerequisite does. Completing a migration is irreversible, so "Mosaic could
  // not read the prerequisites" must never be the state it is done from.
  const completionBlockers =
    completion?.status === "error"
      ? ["completion prerequisites could not be read"]
      : migrationCompletionBlockers(
          completion?.status === "ok" ? completion.prerequisites : undefined
        );
  const granted = canRunMigrationCommand(detail, capability);
  const values: CommandInputs = {
    approvalDigest,
    authorityDigest,
    caseDigest,
    digests,
    expectedDigest,
    expiresAt,
    prerequisiteDigest,
    reason,
    referenceId,
    scopeKind,
    secondaryId,
  };
  const boundInputsPresent = hasBoundInputs(name, values);
  const needsReason = commandNeedsReason(name);
  const disabledReason = commandDisabledReason({
    acknowledged,
    boundInputsPresent,
    capability,
    completionBlockers,
    expiresAt,
    granted,
    name,
    needsReason,
    organizationRole,
    reason,
  });

  const submit = useCallback(async () => {
    const command = buildLifecycleCommand(
      name,
      {
        approvalDigest,
        authorityDigest,
        caseDigest,
        digests,
        expectedDigest,
        expiresAt,
        prerequisiteDigest,
        reason,
        referenceId,
        scopeKind,
        secondaryId,
      },
      program
    );
    try {
      await mutation.mutateAsync({
        command,
        idempotencyKey: createMigrationCommandKey(),
      });
    } catch {
      // Surfaced via mutation.isError; the form keeps its values so the
      // operator can review and retry without retyping.
      return;
    }
    setReason("");
    setAcknowledged(false);
  }, [
    approvalDigest,
    authorityDigest,
    caseDigest,
    digests,
    expectedDigest,
    expiresAt,
    mutation,
    name,
    prerequisiteDigest,
    program,
    reason,
    referenceId,
    scopeKind,
    secondaryId,
  ]);

  const handleConfirm = useCallback(() => {
    submit();
  }, [submit]);
  const facts = lifecycleFacts(name, values, program);

  return (
    <div className="space-y-5">
      <section className="rounded border p-4">
        <h2 className="font-semibold">Lifecycle command builder</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Commands are compare-and-swap operations. A 409 refreshes Program and
          operational state and requires a new review. Production proposal and
          approval must be performed by distinct humans; a proposer cannot
          approve their own command.
        </p>
        <LifecycleCommandFields
          acknowledged={acknowledged}
          commandOptions={commandOptions}
          fieldIds={fieldIds}
          name={name}
          onAcknowledgedChange={setAcknowledged}
          onNameChange={setName}
          setters={{
            setApprovalDigest,
            setAuthorityDigest,
            setCaseDigest,
            setDigests,
            setExpectedDigest,
            setExpiresAt,
            setPrerequisiteDigest,
            setReason,
            setReferenceId,
            setScopeKind,
            setSecondaryId,
          }}
          values={values}
        />
        <div className="mt-4">
          <MigrationImpactReviewAction
            actionLabel={`Run ${name.replaceAll("_", " ")}`}
            binding={`${name}:${program.stateVersion}:${referenceId}:${secondaryId}:${expectedDigest}:${reason}`}
            confirmationCopy="I reviewed the exact state, scope, digests, reason, and authority or retention consequence."
            disabledReason={disabledReason}
            facts={facts}
            impactSummary={impact[name]}
            isPending={mutation.isPending}
            onConfirm={handleConfirm}
            pendingLabel="Submitting command…"
            title="Review dangerous command"
          />
        </div>
        {mutation.isError ? (
          <p className="mt-3 text-destructive text-sm" role="alert">
            The command failed. If state or evidence was stale, Mosaic refreshed
            it; review every value before retrying.
          </p>
        ) : null}
      </section>

      <LifecycleTimelines
        completion={completion}
        completionBlockers={completionBlockers}
        data={data}
        program={program}
      />
    </div>
  );
}

/**
 * The recorded history behind the command builder: what was proposed, approved,
 * executed, and reconciled. Separate panels keep two-person control visible —
 * an approval is never rendered as part of the proposal it attests to.
 */
function LifecycleTimelines({
  completion,
  completionBlockers,
  data,
  program,
}: {
  completion: MigrationCompletionInspection | undefined;
  completionBlockers: string[];
  data: LifecycleData | undefined;
  program: MigrationProgramView["program"];
}) {
  return (
    <section className="grid gap-5 xl:grid-cols-2">
      <div className="rounded border p-4">
        <h2 className="font-semibold">Proposals, approvals, and checkpoints</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Approval records remain separate from proposals so two-person
          production control is visible.
        </p>
        <Timeline
          records={[
            ...(data?.proposals ?? []),
            ...(data?.approvals ?? []),
            ...(data?.checkpoints ?? []),
          ]}
        />
      </div>
      <div className="rounded border p-4">
        <h2 className="font-semibold">Authority executions</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Cutover and rollback always create monotonic authority epochs.
        </p>
        <Timeline records={data?.executions ?? []} />
      </div>
      <div className="rounded border p-4">
        <h2 className="font-semibold">Stabilization and rollback readiness</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          The rollback window is {program.rollbackWindowDays} days. Completion
          stays blocked until the window and server-derived health policy are
          satisfied.
        </p>
        <Timeline
          records={[
            ...(data?.observations ?? []),
            ...(data?.rollbackAssessments ?? []),
          ]}
        />
      </div>
      <div className="rounded border p-4">
        <h2 className="font-semibold">Reconciliation cases and evidence</h2>
        <Timeline records={data?.cases ?? []} />
      </div>
      <div className="rounded border p-4">
        <h2 className="font-semibold">
          Approved repair previews and executions
        </h2>
        <Timeline
          records={[
            ...(data?.repairPreviews ?? []),
            ...(data?.repairExecutions ?? []),
          ]}
        />
      </div>
      <div className="rounded border p-4">
        <h2 className="font-semibold">Webhook redelivery</h2>
        <Timeline records={data?.webhookRedeliveries ?? []} />
      </div>
      <div className="rounded border p-4">
        <h2 className="font-semibold">Credential removal and legal hold</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Only redacted metadata is returned. Secrets are never redisplayed.
        </p>
        <Timeline
          records={[
            ...(data?.removals ?? []),
            ...(data?.holdProposals ?? []),
            ...(data?.holds ?? []),
          ]}
        />
      </div>
      <div className="rounded border p-4">
        <h2 className="font-semibold">Completion reports and audit history</h2>
        {completion?.status === "error" ? (
          <div className="mt-3 text-sm" role="alert">
            <p className="font-medium text-destructive">
              Completion prerequisites could not be read
            </p>
            <p className="mt-1 text-muted-foreground leading-6">
              {describeApiError(completion.error).description} This is a failed
              read, not a report that completion is unavailable — nothing here
              says whether the migration is eligible to be completed. Retry once
              the cause is resolved.
            </p>
          </div>
        ) : null}
        {completion?.status === "ok" ? (
          <div className="mt-3 text-sm">
            {completionBlockers.length ? (
              <>
                <p className="font-medium">Completion blocked</p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {completionBlockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="font-medium">
                Server-derived completion prerequisites are satisfied.
              </p>
            )}
          </div>
        ) : null}
        {completion === undefined || completion.status === "absent" ? (
          <p className="mt-2 text-muted-foreground text-sm">
            Completion inspection has not produced a report for this program
            yet.
          </p>
        ) : null}
        <Timeline records={data?.reports ?? []} />
      </div>
    </section>
  );
}

function LifecycleCommandFields({
  acknowledged,
  commandOptions,
  fieldIds,
  name,
  onAcknowledgedChange,
  onNameChange,
  setters,
  values,
}: {
  acknowledged: boolean;
  commandOptions: { label: string; value: string }[];
  fieldIds: string;
  name: CommandName;
  onAcknowledgedChange: (acknowledged: boolean) => void;
  onNameChange: (name: CommandName) => void;
  setters: CommandInputSetters;
  values: CommandInputs;
}) {
  const {
    approvalDigest,
    authorityDigest,
    caseDigest,
    digests,
    expectedDigest,
    expiresAt,
    prerequisiteDigest,
    reason,
    referenceId,
    scopeKind,
    secondaryId,
  } = values;
  return (
    <>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="text-sm">
          <label htmlFor="lifecycle-command">Command</label>
          <Select
            items={commandOptions}
            onValueChange={(value) => onNameChange(value as CommandName)}
            value={name}
          >
            <SelectTrigger className="mt-1" id="lifecycle-command">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {commandOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="text-sm" htmlFor={`${fieldIds}-primary-reference`}>
          Primary reference
          <Input
            id={`${fieldIds}-primary-reference`}
            onChange={(event) => setters.setReferenceId(event.target.value)}
            placeholder="proposal, checkpoint, case, preview, or event ID"
            value={referenceId}
          />
        </label>
        <label className="text-sm" htmlFor={`${fieldIds}-secondary-reference`}>
          Secondary reference
          <Input
            id={`${fieldIds}-secondary-reference`}
            onChange={(event) => setters.setSecondaryId(event.target.value)}
            placeholder="approval, repair kind, or destination ID"
            value={secondaryId}
          />
        </label>
        <label
          className="text-sm"
          htmlFor={`${fieldIds}-expected-object-digest`}
        >
          Expected object digest
          <Input
            id={`${fieldIds}-expected-object-digest`}
            onChange={(event) => setters.setExpectedDigest(event.target.value)}
            value={expectedDigest}
          />
        </label>
        <label
          className="text-sm"
          htmlFor={`${fieldIds}-expected-authority-digest`}
        >
          Expected authority digest
          <Input
            id={`${fieldIds}-expected-authority-digest`}
            onChange={(event) => setters.setAuthorityDigest(event.target.value)}
            value={authorityDigest}
          />
        </label>
        <label
          className="text-sm"
          htmlFor={`${fieldIds}-expected-prerequisite-digest`}
        >
          Expected prerequisite digest
          <Input
            id={`${fieldIds}-expected-prerequisite-digest`}
            onChange={(event) =>
              setters.setPrerequisiteDigest(event.target.value)
            }
            value={prerequisiteDigest}
          />
        </label>
        <label
          className="text-sm"
          htmlFor={`${fieldIds}-expected-approval-digest`}
        >
          Expected approval digest
          <Input
            id={`${fieldIds}-expected-approval-digest`}
            onChange={(event) => setters.setApprovalDigest(event.target.value)}
            value={approvalDigest}
          />
        </label>
        <label className="text-sm" htmlFor={`${fieldIds}-expected-case-digest`}>
          Expected case digest
          <Input
            id={`${fieldIds}-expected-case-digest`}
            onChange={(event) => setters.setCaseDigest(event.target.value)}
            value={caseDigest}
          />
        </label>
        <label className="text-sm" htmlFor={`${fieldIds}-scope-kind`}>
          Scope kind
          <Input
            id={`${fieldIds}-scope-kind`}
            onChange={(event) => setters.setScopeKind(event.target.value)}
            value={scopeKind}
          />
        </label>
        {digestNames.map((digestName) => (
          <label
            className="text-sm"
            htmlFor={`${fieldIds}-expected-digest`}
            key={digestName}
          >
            Expected {digestName} digest
            <Input
              id={`${fieldIds}-expected-digest`}
              onChange={(event) =>
                setters.setDigests((current) => ({
                  ...current,
                  [digestName]: event.target.value,
                }))
              }
              value={digests[digestName]}
            />
          </label>
        ))}
        <label
          className="text-sm md:col-span-2 xl:col-span-3"
          htmlFor={`${fieldIds}-reason`}
        >
          Reason
          <Input
            id={`${fieldIds}-reason`}
            onChange={(event) => setters.setReason(event.target.value)}
            placeholder="Explain the incident, evidence, or operational need"
            value={reason}
          />
        </label>
        <label className="text-sm" htmlFor={`${fieldIds}-expires-at`}>
          Expires at
          <Input
            id={`${fieldIds}-expires-at`}
            onChange={(event) => setters.setExpiresAt(event.target.value)}
            type="datetime-local"
            value={expiresAt}
          />
        </label>
      </div>
      {name === "remove_credential" ? (
        <label className="mt-3 flex gap-2 text-sm">
          <input
            checked={acknowledged}
            onChange={(event) =>
              onAcknowledgedChange(event.currentTarget.checked)
            }
            type="checkbox"
          />
          I understand the credential cannot be redisplayed or recovered, and
          rollback may become unavailable.
        </label>
      ) : null}
    </>
  );
}
