import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/features/billing-ledger/components/billing-chrome";
import {
  evaluatePublishGate,
  type GrantProposal,
  grantPolicyFields,
  grantPolicyLabel,
  grantPolicyNote,
  impactHeadline,
  narrowingCodeExplanation,
  PAUSE_POLICY_NOTE,
  proposalFingerprint,
} from "@/features/entitlement-grants/types/grant-version-view";
import type { Entitlement, GrantVersionImpact, Product } from "@/generated/api";

type PurchaseType = "auto_renewable_subscription" | "non_consumable";

interface PublishGrantVersionWizardProps {
  canManage: boolean;
  entitlementId: string;
  entitlements: readonly Entitlement[];
  onPreview: (
    proposal: GrantProposal
  ) => Promise<GrantVersionImpact | undefined>;
  onPublish: (proposal: GrantProposal) => Promise<void>;
  productId: string;
  products: readonly Product[];
  triggerLabel?: string;
}

/**
 * Creating the next grant version.
 *
 * Three deliberate steps, in this order and no other: describe the shape,
 *see what it would touch*, then publish with a reason. The middle step is not
 * a review screen an operator can skip — it is the only place
 * `impactedActiveSources` is stated, and that number is the answer to "how many
 * customers could lose access". Preview writes nothing, including no audit
 * event, so requiring it costs nothing and buys the whole confirmation.
 *
 * There is no edit path anywhere in this component. A published version is a
 * historical fact about what someone bought; the only forward action is another
 * version.
 */
export function PublishGrantVersionWizard({
  canManage,
  entitlementId,
  entitlements,
  onPreview,
  onPublish,
  productId,
  products,
  triggerLabel = "Create new version",
}: PublishGrantVersionWizardProps) {
  const handleClick4 = useCallback(() => setStep("review"), []);
  const handleClick3 = useCallback(() => setStep("publish"), []);
  const handleClick2 = useCallback(() => setStep("shape"), []);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"publish" | "review" | "shape">("shape");
  const [impact, setImpact] = useState<GrantVersionImpact | undefined>(
    undefined
  );
  const [previewedFingerprint, setPreviewedFingerprint] = useState<
    string | undefined
  >(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [proposal, setProposal] = useState<GrantProposal>({
    effectiveStart: defaultEffectiveStart(),
    entitlementId,
    grantsInActive: true,
    grantsInGrace: true,
    grantsInOneTimeOwnership: true,
    grantsInTrial: true,
    productId,
    reason: "",
    supportedPurchaseTypes: ["auto_renewable_subscription"],
  });

  /**
   * Any change to a published field discards the preview. The alternative —
   * keeping the earlier numbers on screen — would let an operator confirm a
   * blast radius that describes a proposal they have since edited.
   */
  function update(patch: Partial<GrantProposal>) {
    setProposal((current) => {
      const next = { ...current, ...patch };
      if (proposalFingerprint(next) !== proposalFingerprint(current)) {
        setImpact(undefined);
        setPreviewedFingerprint(undefined);
        setStep("shape");
      }
      return next;
    });
  }

  const productOptions = products.map((product) => ({
    label: product.internalName,
    value: product.id,
  }));
  const entitlementOptions = entitlements.map((entitlement) => ({
    label: entitlement.name,
    value: entitlement.id,
  }));

  const gate = evaluatePublishGate({
    canManage,
    impact,
    isSubmitting: busy,
    previewedFingerprint,
    proposal,
  });

  function reset() {
    setStep("shape");
    setImpact(undefined);
    setPreviewedFingerprint(undefined);
    setError(null);
    setBusy(false);
  }

  async function preview() {
    setBusy(true);
    setError(null);
    try {
      const result = await onPreview(proposal);
      setImpact(result);
      setPreviewedFingerprint(proposalFingerprint(proposal));
      setStep("review");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Mosaic could not preview this change."
      );
    } finally {
      setBusy(false);
    }
  }

  const handleClick = useCallback(() => {
    preview();
  }, [preview]);
  async function publish() {
    setBusy(true);
    setError(null);
    try {
      await onPublish(proposal);
      setOpen(false);
      reset();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Mosaic could not publish this version."
      );
    } finally {
      setBusy(false);
    }
  }

  const handleClick5 = useCallback(() => {
    publish();
  }, [publish]);
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          reset();
        }
      }}
      open={open}
    >
      <DialogTrigger render={<Button disabled={!canManage} type="button" />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-4rem)] gap-0 overflow-y-auto sm:max-w-xl">
        <DialogHeader className="border-b p-5">
          <DialogTitle>Create a new grant version</DialogTitle>
          <DialogDescription>
            Published versions are never edited. This creates the next version
            and closes the current one at exactly its start, so the two
            intervals abut with no gap and no overlap.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 p-5">
          <ol className="flex flex-wrap gap-2 text-muted-foreground text-xs">
            <StepChip active={step === "shape"} index={1} label="Shape" />
            <StepChip
              active={step === "review"}
              index={2}
              label="Impact preview"
            />
            <StepChip active={step === "publish"} index={3} label="Publish" />
          </ol>

          {step === "shape" ? (
            <>
              <Field>
                <FieldLabel htmlFor="grant-version-product">Product</FieldLabel>
                <Select
                  items={productOptions}
                  onValueChange={(value) => update({ productId: value })}
                  value={proposal.productId}
                >
                  <SelectTrigger id="grant-version-product">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {productOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="grant-version-entitlement">
                  Entitlement
                </FieldLabel>
                <Select
                  items={entitlementOptions}
                  onValueChange={(value) => update({ entitlementId: value })}
                  value={proposal.entitlementId}
                >
                  <SelectTrigger id="grant-version-entitlement">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {entitlementOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  One version history belongs to one (Product, Entitlement)
                  pair.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="grant-version-start">
                  Takes effect at (local time)
                </FieldLabel>
                <Input
                  id="grant-version-start"
                  onChange={(event) =>
                    update({
                      effectiveStart: toIsoInstant(event.currentTarget.value),
                    })
                  }
                  type="datetime-local"
                  value={toLocalInput(proposal.effectiveStart)}
                />
                <FieldDescription>
                  The projection engine selects a version by each
                  purchase&rsquo;s own effective time, not by now. A change that
                  silently applied to yesterday is the failure grant versioning
                  exists to prevent, so backdating is a separate, checked
                  choice.
                </FieldDescription>
              </Field>

              <label className="flex items-start gap-2 text-sm">
                <input
                  checked={proposal.retroactive === true}
                  className="mt-1"
                  onChange={(event) =>
                    update({ retroactive: event.currentTarget.checked })
                  }
                  type="checkbox"
                />
                <span>
                  Backdate this version
                  <span className="block text-muted-foreground text-xs leading-5">
                    A retroactive version may add Entitlements or widen access
                    policy, never remove or narrow either. Taking access from a
                    customer who did nothing wrong is the one shape Mosaic
                    refuses.
                  </span>
                </span>
              </label>

              <fieldset className="space-y-2">
                <legend className="font-semibold text-sm">
                  Purchase types this version covers
                </legend>
                {(
                  [
                    "auto_renewable_subscription",
                    "non_consumable",
                  ] as PurchaseType[]
                ).map((type) => (
                  <label className="flex items-center gap-2 text-sm" key={type}>
                    <input
                      checked={(proposal.supportedPurchaseTypes ?? []).includes(
                        type
                      )}
                      onChange={(event) =>
                        update({
                          supportedPurchaseTypes: event.currentTarget.checked
                            ? [...(proposal.supportedPurchaseTypes ?? []), type]
                            : (proposal.supportedPurchaseTypes ?? []).filter(
                                (item) => item !== type
                              ),
                        })
                      }
                      type="checkbox"
                    />
                    {type === "auto_renewable_subscription"
                      ? "Auto-renewable subscription"
                      : "Non-consumable"}
                  </label>
                ))}
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="font-semibold text-sm">
                  Subscription states that grant access
                </legend>
                {grantPolicyFields.map((field) => (
                  <label className="flex items-start gap-2 text-sm" key={field}>
                    <input
                      checked={proposal[field] === true}
                      className="mt-1"
                      onChange={(event) =>
                        update({ [field]: event.currentTarget.checked })
                      }
                      type="checkbox"
                    />
                    <span>
                      {grantPolicyLabel(field)}
                      {grantPolicyNote(field) ? (
                        <span className="block text-muted-foreground text-xs leading-5">
                          {grantPolicyNote(field)}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
                <p className="text-muted-foreground text-xs leading-5">
                  {PAUSE_POLICY_NOTE}
                </p>
              </fieldset>
            </>
          ) : null}

          {step !== "shape" && impact ? (
            <div className="space-y-3">
              <div className="rounded border p-4">
                <p className="font-semibold text-sm leading-6">
                  {impactHeadline(impact)}
                </p>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  <ImpactRow
                    label="Purchases currently granting access"
                    value={impact.impactedActiveSources ?? 0}
                  />
                  <ImpactRow
                    label="Billing Customers citing this Product"
                    value={impact.impactedCustomers ?? 0}
                  />
                  <ImpactRow
                    label="Entitlements a reprojection would re-derive"
                    value={impact.impactedEntitlements ?? 0}
                  />
                  <ImpactRow
                    label="Products a reprojection would re-derive"
                    value={impact.impactedProducts ?? 0}
                  />
                </dl>
                <p className="mt-3 text-muted-foreground text-xs leading-5">
                  Every count is from current committed state — the snapshot
                  each customer&rsquo;s pointer names, not the whole snapshot
                  history. Previewing writes nothing, not even an audit event.
                </p>
              </div>

              {impact.additiveSuperset === false ? (
                <div className="rounded border border-destructive/35 bg-destructive/10 p-4">
                  <StatusPill
                    label="Publish would be refused"
                    tone="negative"
                  />
                  <p className="mt-2 text-sm leading-6">
                    {narrowingCodeExplanation(impact.narrowingCode)}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === "publish" ? (
            <Field>
              <FieldLabel htmlFor="grant-version-reason">
                Reason for this change
              </FieldLabel>
              <Input
                id="grant-version-reason"
                onChange={(event) => {
                  // The value is read before the updater runs: React nulls
                  // `currentTarget` once the handler returns, so a lazy read
                  // inside the updater throws.
                  const reason = event.currentTarget.value;
                  setProposal((current) => ({ ...current, reason }));
                }}
                value={proposal.reason ?? ""}
              />
              <FieldDescription>
                Recorded with the version and the audit event. It is what an
                investigation reads months from now.
              </FieldDescription>
            </Field>
          ) : null}

          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="flex-col border-t p-5 sm:flex-col sm:justify-start">
          <div className="flex flex-wrap gap-2">
            {step === "shape" ? (
              <Button disabled={busy} onClick={handleClick} type="button">
                {busy ? "Previewing…" : "Preview impact"}
              </Button>
            ) : null}
            {step === "review" ? (
              <>
                <Button onClick={handleClick2} type="button" variant="outline">
                  Back to shape
                </Button>
                <Button
                  disabled={impact?.additiveSuperset === false}
                  onClick={handleClick3}
                  type="button"
                >
                  Continue to publish
                </Button>
              </>
            ) : null}
            {step === "publish" ? (
              <>
                <Button onClick={handleClick4} type="button" variant="outline">
                  Back to impact
                </Button>
                <Button
                  disabled={!gate.allowed}
                  onClick={handleClick5}
                  type="button"
                >
                  {busy ? "Publishing…" : "Publish new version"}
                </Button>
              </>
            ) : null}
          </div>
          {gate.explanation && step === "publish" ? (
            <p className="text-muted-foreground text-xs leading-5">
              {gate.explanation}
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs leading-5">
            Publishing enqueues a reprojection for every Billing Customer whose
            current snapshot cites this Product, in the same transaction as the
            version itself.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepChip({
  active,
  index,
  label,
}: {
  active: boolean;
  index: number;
  label: string;
}) {
  return (
    <li>
      <span
        className={`inline-flex rounded-full border px-2.5 py-1 ${
          active
            ? "border-primary/35 bg-primary/10 font-medium text-primary"
            : "border-border"
        }`}
      >
        {index}. {label}
      </span>
    </li>
  );
}

function ImpactRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-semibold text-sm">{value}</dd>
    </div>
  );
}

function defaultEffectiveStart() {
  return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function toLocalInput(iso: string | undefined) {
  if (!iso) {
    return "";
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoInstant(local: string) {
  if (!local) {
    return "";
  }
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}
