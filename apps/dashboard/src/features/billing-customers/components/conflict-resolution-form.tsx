import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  type ConflictAction,
  conflictActionConsequence,
  conflictActionLabel,
  conflictActions,
  evaluateResolutionGate,
  expectedAssignee,
} from "@/features/billing-customers/types/conflict-resolution";
import { StatusPill } from "@/features/billing-ledger/components/billing-chrome";
import type { ResolveIdentityConflictRequest } from "@/generated/api";

interface ConflictResolutionFormProps {
  canManage: boolean;
  firstCustomerId: string | undefined;
  membersHref: string;
  onResolve: (request: ResolveIdentityConflictRequest) => Promise<void>;
  secondCustomerId: string | undefined;
}

/**
 * Resolving an identity conflict, deliberately in four steps.
 *
 * There is no one-click merge here and there is no default selection, because
 * this is the operation that moves real purchases between real people and it
 * cannot be undone by re-running it. The sequence forces the operator past the
 * consequence of the *specific* choice they made — including what happens to
 * the party they are not looking at — before anything is submittable.
 *
 * Modelled on the 9A quarantine recovery actions, with one addition: a reason
 * is required by the API, and it is what an investigation reads when someone
 * asks why their purchase moved.
 */
export function ConflictResolutionForm({
  canManage,
  firstCustomerId,
  membersHref,
  onResolve,
  secondCustomerId,
}: ConflictResolutionFormProps) {
  const [action, setAction] = useState<ConflictAction | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gate = evaluateResolutionGate({
    acknowledged,
    action,
    canManage,
    firstCustomerId,
    isSubmitting: submitting,
    reason,
    secondCustomerId,
  });

  if (!canManage) {
    return (
      <div className="rounded border p-4">
        <p className="text-sm leading-6">
          Resolving an identity conflict requires organization owner or admin
          permission.
        </p>
        <a
          className="mt-2 inline-flex font-semibold text-primary text-sm"
          href={membersHref}
        >
          Ask an Owner or Admin to resolve this conflict
        </a>
      </div>
    );
  }

  async function submit() {
    if (!action) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const assignee = expectedAssignee({
        action,
        firstCustomerId,
        secondCustomerId,
      });
      await onResolve({
        action,
        reason: reason.trim(),
        ...(assignee ? { assignedBillingCustomerId: assignee } : {}),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Mosaic could not record this resolution."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset className="space-y-3">
        <legend className="font-semibold text-sm">
          1. Choose how this resolves
        </legend>
        {conflictActions.map((candidate) => (
          <label className="flex items-start gap-2 text-sm" key={candidate}>
            <input
              checked={action === candidate}
              className="mt-1"
              name="conflict-action"
              onChange={() => {
                setAction(candidate);
                // Changing the choice withdraws the acknowledgement: it was
                // given for a different consequence than the one now selected.
                setAcknowledged(false);
              }}
              type="radio"
              value={candidate}
            />
            <span>{conflictActionLabel(candidate)}</span>
          </label>
        ))}
      </fieldset>

      {action ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="font-semibold text-sm">2. What this does</p>
          <p className="mt-2 text-sm leading-6">
            {conflictActionConsequence(action)}
          </p>
          {expectedAssignee({ action, firstCustomerId, secondCustomerId }) ? (
            <p className="mt-2 break-all font-mono text-muted-foreground text-xs">
              The disputed purchase will be assigned to{" "}
              {expectedAssignee({ action, firstCustomerId, secondCustomerId })}.
            </p>
          ) : (
            <p className="mt-2 text-muted-foreground text-xs leading-5">
              The disputed purchase will be assigned to neither customer.
            </p>
          )}
        </div>
      ) : null}

      <Field>
        <FieldLabel htmlFor="conflict-reason">
          3. Reason for this resolution
        </FieldLabel>
        <Input
          disabled={!action}
          id="conflict-reason"
          onChange={(event) => {
            const value = event.currentTarget.value;
            setReason(value);
          }}
          value={reason}
        />
        <FieldDescription>
          Required. Recorded on the conflict and on the audit event, and read by
          whoever investigates this later.
        </FieldDescription>
      </Field>

      <label className="flex items-start gap-2 text-sm">
        <input
          checked={acknowledged}
          className="mt-1"
          disabled={!action}
          onChange={(event) => setAcknowledged(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>
          4. I have read what happens to both customers and accept that this
          moves purchases between them.
        </span>
      </label>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!gate.allowed} type="submit">
          {submitting ? "Recording…" : "Record this resolution"}
        </Button>
        {gate.explanation ? (
          <p className="text-muted-foreground text-xs leading-5">
            {gate.explanation}
          </p>
        ) : (
          <StatusPill label="Ready to record" tone="attention" />
        )}
      </div>
    </form>
  );
}
