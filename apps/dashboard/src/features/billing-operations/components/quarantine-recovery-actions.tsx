import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type QuarantineRecoveryAction,
  quarantineNoActionExplanation,
  quarantineRecoveryActions,
} from "@/features/billing-operations/types/quarantine-recovery";
import { WorkflowPanel } from "@/features/orgs/components/workspace-page";
import type { QuarantineRecord } from "@/generated/api";

interface QuarantineRecoveryActionsProps {
  canManage: boolean;
  closeError?: string;
  isClosing: boolean;
  isRetrying: boolean;
  membersHref: string;
  onCloseSuperseded: (supersededByRecordId: string) => void;
  onRetryValidation: () => void;
  productMappingHref: string;
  /** The store Product this input named; absent when it never got that far. */
  providerProductIdentifier?: string;
  record: QuarantineRecord;
  retryError?: string;
  storeConnectionsHref: string;
}

/**
 * The recovery controls for one quarantine record.
 *
 * The set is derived from `quarantineRecoveryActions`, not assembled here, so
 * the prohibition on asserting validity lives in one testable place. Note what
 * is missing and must stay missing: no "Mark as valid", "Force resolve",
 * "Accept anyway", or "Ignore". The only route to a Transaction Fact is asking
 * the store again.
 */
export function QuarantineRecoveryActionsPanel({
  canManage,
  closeError,
  isClosing,
  isRetrying,
  membersHref,
  onCloseSuperseded,
  onRetryValidation,
  productMappingHref,
  providerProductIdentifier,
  record,
  retryError,
  storeConnectionsHref,
}: QuarantineRecoveryActionsProps) {
  const [supersededBy, setSupersededBy] = useState("");
  const actions = quarantineRecoveryActions(record);

  return (
    <WorkflowPanel
      description="A quarantined input becomes a Transaction Fact only by asking the store again and succeeding. There is deliberately no control that records a validated fact from an operator's judgement."
      title="Recovery"
    >
      {canManage ? (
        actions.length === 0 ? (
          <div className="rounded border border-border bg-muted/30 p-4 text-sm leading-6">
            <p className="font-medium">
              No recovery action applies to this record.
            </p>
            <p className="mt-1 text-muted-foreground">
              {quarantineNoActionExplanation(record.reasonCode)}
            </p>
            <a
              className="mt-2 inline-flex font-semibold text-primary text-sm"
              href={storeConnectionsHref}
            >
              Review Store Server Credentials
            </a>
          </div>
        ) : (
          <ul className="space-y-3">
            {actions.map((action) => (
              <li className="rounded border p-4" key={action.kind}>
                <p className="font-semibold text-sm">{action.label}</p>
                <p className="mt-1 text-muted-foreground text-sm leading-6">
                  {action.description}
                </p>
                <ActionControl
                  action={action}
                  closeError={closeError}
                  isClosing={isClosing}
                  isRetrying={isRetrying}
                  onCloseSuperseded={() =>
                    onCloseSuperseded(supersededBy.trim())
                  }
                  onRetryValidation={onRetryValidation}
                  productMappingHref={productMappingHref}
                  {...(providerProductIdentifier
                    ? { providerProductIdentifier }
                    : {})}
                  retryError={retryError}
                  setSupersededBy={setSupersededBy}
                  storeConnectionsHref={storeConnectionsHref}
                  supersededBy={supersededBy}
                />
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="text-muted-foreground text-sm">
          Organization owner or admin permission is required to run a recovery
          action.{" "}
          <a className="font-semibold text-primary" href={membersHref}>
            Ask an Owner or Admin
          </a>
        </p>
      )}
    </WorkflowPanel>
  );
}

function ActionControl({
  action,
  closeError,
  isClosing,
  isRetrying,
  onCloseSuperseded,
  onRetryValidation,
  productMappingHref,
  providerProductIdentifier,
  retryError,
  setSupersededBy,
  storeConnectionsHref,
  supersededBy,
}: {
  action: QuarantineRecoveryAction;
  closeError?: string;
  isClosing: boolean;
  isRetrying: boolean;
  onCloseSuperseded: () => void;
  onRetryValidation: () => void;
  productMappingHref: string;
  providerProductIdentifier?: string;
  retryError?: string;
  setSupersededBy: (value: string) => void;
  storeConnectionsHref: string;
  supersededBy: string;
}) {
  const fieldIds = useId();
  switch (action.kind) {
    case "retry_provider_validation":
      return (
        <div className="mt-3">
          <Button
            disabled={isRetrying}
            onClick={onRetryValidation}
            type="button"
          >
            {isRetrying ? "Re-queueing…" : "Re-run validation"}
          </Button>
          {retryError ? (
            <p className="mt-2 text-destructive text-sm" role="alert">
              {retryError}
            </p>
          ) : null}
        </div>
      );
    case "close_superseded":
      return (
        <div className="mt-3 space-y-2">
          <label
            className="block max-w-sm space-y-1 font-medium text-xs"
            htmlFor={`${fieldIds}-quarantine-record-that-replaced-this-one`}
          >
            Quarantine record that replaced this one
            <Input
              id={`${fieldIds}-quarantine-record-that-replaced-this-one`}
              onChange={(event) => setSupersededBy(event.currentTarget.value)}
              placeholder="Quarantine record ID"
              spellCheck={false}
              value={supersededBy}
            />
          </label>
          <Button
            disabled={isClosing || supersededBy.trim().length === 0}
            onClick={onCloseSuperseded}
            type="button"
            variant="outline"
          >
            {isClosing ? "Closing…" : "Close as superseded"}
          </Button>
          <p className="text-muted-foreground text-xs leading-5">
            Closing asserts nothing about the original input and produces no
            Transaction Fact. The record and its history stay readable.
          </p>
          {closeError ? (
            <p className="text-destructive text-sm" role="alert">
              {closeError}
            </p>
          ) : null}
        </div>
      );
    case "repair_product_mapping":
      return (
        <div className="mt-3 space-y-2">
          {providerProductIdentifier ? (
            <p className="text-muted-foreground text-xs leading-5">
              Map the store Product{" "}
              <code className="select-all rounded bg-muted px-1 py-0.5 font-mono">
                {providerProductIdentifier}
              </code>{" "}
              to a Mosaic Product. Replacing a mapping keeps the previous one in
              history, so past resolutions stay reproducible.
            </p>
          ) : (
            <p className="text-muted-foreground text-xs leading-5">
              This input never got far enough to name a store Product, so there
              is nothing to map yet. Confirm the credential and Application
              scope first.
            </p>
          )}
          <a
            className="inline-flex font-semibold text-primary text-sm"
            href={productMappingHref}
          >
            {providerProductIdentifier
              ? "Find the Mosaic Product for this store Product"
              : "Open Products"}
          </a>
          <p className="text-muted-foreground text-xs leading-5">
            Mosaic brings you back to this record when you are done, so you can
            re-run validation without navigating from memory.
          </p>
        </div>
      );
    default:
      return (
        <a
          className="mt-3 inline-flex font-semibold text-primary text-sm"
          href={storeConnectionsHref}
        >
          Open Store Server Credentials
        </a>
      );
  }
}
