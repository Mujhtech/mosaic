import { type QueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";

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
  type MigrationProgramView,
  migrationCompletionBlockers,
} from "@/features/billing-migrations/types/migration-operations";
import type {
  BillingMigrationApproval,
  BillingMigrationAuthorityExecution,
  BillingMigrationCase,
  BillingMigrationCheckpoint,
  BillingMigrationCompletionPrerequisites,
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
  completion: BillingMigrationCompletionPrerequisites | undefined;
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
  const program = detail.program;
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
  const completionBlockers = migrationCompletionBlockers(data?.completion);
  const granted = canRunMigrationCommand(detail, capability);
  const allDigestsPresent = digestNames.every((digestName) =>
    digests[digestName].trim()
  );
  const boundInputsPresent = (() => {
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
    }
  })();
  const needsReason = ![
    "approve_cutover",
    "approve_rollback",
    "checkpoint",
    "execute_repair",
    "approve_legal_hold",
    "complete",
    "observe_stabilization",
  ].includes(name);
  const disabledReason = granted
    ? needsReason && reason.trim().length < 8
      ? "Enter a specific operational reason of at least 8 characters."
      : boundInputsPresent
        ? name === "complete" && completionBlockers.length > 0
          ? `Completion is blocked: ${completionBlockers.join(", ")}`
          : [
                "propose_cutover",
                "propose_rollback",
                "preview_repair",
                "propose_legal_hold",
              ].includes(name) && !expiresAt
            ? "Enter the explicit approval or preview expiry time."
            : name === "remove_credential" && !acknowledged
              ? "Acknowledge that credential removal is irreversible and can prevent rollback."
              : null
        : "Enter every reference and expected digest required to bind this command to reviewed server state."
    : `The server has not granted ${capability}. Organization role ${organizationRole ?? "unknown"} is explanatory only.`;

  async function submit() {
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
    const command = (() => {
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
                secondaryId === "release"
                  ? ("release" as const)
                  : ("set" as const),
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
      }
    })();
    await mutation.mutateAsync({
      command,
      idempotencyKey: createMigrationCommandKey(),
    });
    setReason("");
    setAcknowledged(false);
  }

  const facts = [
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
    { label: "Primary reference", value: referenceId || "Not supplied" },
    {
      label: "Expected digest",
      value: expectedDigest || "See bound digest fields",
    },
    { label: "Authority consequence", value: impact[name] },
  ];

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
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="text-sm">
            <label htmlFor="lifecycle-command">Command</label>
            <Select
              items={commandOptions}
              onValueChange={(value) => setName(value as CommandName)}
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
          <label className="text-sm">
            Primary reference
            <Input
              onChange={(event) => setReferenceId(event.target.value)}
              placeholder="proposal, checkpoint, case, preview, or event ID"
              value={referenceId}
            />
          </label>
          <label className="text-sm">
            Secondary reference
            <Input
              onChange={(event) => setSecondaryId(event.target.value)}
              placeholder="approval, repair kind, or destination ID"
              value={secondaryId}
            />
          </label>
          <label className="text-sm">
            Expected object digest
            <Input
              onChange={(event) => setExpectedDigest(event.target.value)}
              value={expectedDigest}
            />
          </label>
          <label className="text-sm">
            Expected authority digest
            <Input
              onChange={(event) => setAuthorityDigest(event.target.value)}
              value={authorityDigest}
            />
          </label>
          <label className="text-sm">
            Expected prerequisite digest
            <Input
              onChange={(event) => setPrerequisiteDigest(event.target.value)}
              value={prerequisiteDigest}
            />
          </label>
          <label className="text-sm">
            Expected approval digest
            <Input
              onChange={(event) => setApprovalDigest(event.target.value)}
              value={approvalDigest}
            />
          </label>
          <label className="text-sm">
            Expected case digest
            <Input
              onChange={(event) => setCaseDigest(event.target.value)}
              value={caseDigest}
            />
          </label>
          <label className="text-sm">
            Scope kind
            <Input
              onChange={(event) => setScopeKind(event.target.value)}
              value={scopeKind}
            />
          </label>
          {digestNames.map((digestName) => (
            <label className="text-sm" key={digestName}>
              Expected {digestName} digest
              <Input
                onChange={(event) =>
                  setDigests((current) => ({
                    ...current,
                    [digestName]: event.target.value,
                  }))
                }
                value={digests[digestName]}
              />
            </label>
          ))}
          <label className="text-sm md:col-span-2 xl:col-span-3">
            Reason
            <Input
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain the incident, evidence, or operational need"
              value={reason}
            />
          </label>
          <label className="text-sm">
            Expires at
            <Input
              onChange={(event) => setExpiresAt(event.target.value)}
              type="datetime-local"
              value={expiresAt}
            />
          </label>
        </div>
        {name === "remove_credential" ? (
          <label className="mt-3 flex gap-2 text-sm">
            <input
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.currentTarget.checked)}
              type="checkbox"
            />
            I understand the credential cannot be redisplayed or recovered, and
            rollback may become unavailable.
          </label>
        ) : null}
        <div className="mt-4">
          <MigrationImpactReviewAction
            actionLabel={`Run ${name.replaceAll("_", " ")}`}
            binding={`${name}:${program.stateVersion}:${referenceId}:${secondaryId}:${expectedDigest}:${reason}`}
            confirmationCopy="I reviewed the exact state, scope, digests, reason, and authority or retention consequence."
            disabledReason={disabledReason}
            facts={facts}
            impactSummary={impact[name]}
            isPending={mutation.isPending}
            onConfirm={() => {
              submit();
            }}
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

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded border p-4">
          <h2 className="font-semibold">
            Proposals, approvals, and checkpoints
          </h2>
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
          <h2 className="font-semibold">
            Stabilization and rollback readiness
          </h2>
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
          <h2 className="font-semibold">
            Completion reports and audit history
          </h2>
          {data?.completion ? (
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
          ) : (
            <p className="mt-2 text-muted-foreground text-sm">
              Completion inspection is unavailable or has not produced a report.
            </p>
          )}
          <Timeline records={data?.reports ?? []} />
        </div>
      </section>
    </div>
  );
}
