import { useState } from "react";

import { Button } from "@/components/ui/button";

interface ReviewFact {
  label: string;
  value: string;
}

interface Props {
  actionLabel: string;
  binding: string;
  confirmationCopy?: string;
  disabledReason: string | null;
  facts: readonly ReviewFact[];
  impactSummary?: string;
  isPending: boolean;
  onConfirm: () => void;
  pendingLabel: string;
  title: string;
  variant?: "default" | "outline";
}

export function MigrationImpactReviewAction({
  actionLabel,
  binding,
  disabledReason,
  facts,
  impactSummary = "This queues durable migration evidence work. It does not change billing authority or customer access.",
  confirmationCopy = "I reviewed these exact inputs and understand this queues evidence work only.",
  isPending,
  onConfirm,
  pendingLabel,
  title,
  variant = "default",
}: Props) {
  const [confirmedBinding, setConfirmedBinding] = useState<string | null>(null);
  const confirmed = confirmedBinding === binding;
  const explanationId = `${binding.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}-explanation`;
  const buttonLabel = isPending ? pendingLabel : actionLabel;
  return (
    <section className="rounded border border-dashed p-3">
      <h3 className="font-semibold text-sm">{title}</h3>
      <p className="mt-1 text-muted-foreground text-xs">
        Impact: {impactSummary}
      </p>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd className="break-all font-medium">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <label className="mt-3 flex items-start gap-2 text-xs">
        <input
          aria-label={`Confirm ${actionLabel}`}
          checked={confirmed}
          disabled={Boolean(disabledReason) || isPending}
          onChange={(event) =>
            setConfirmedBinding(event.currentTarget.checked ? binding : null)
          }
          type="checkbox"
        />
        {confirmationCopy}
      </label>
      <Button
        aria-describedby={disabledReason ? explanationId : undefined}
        className="mt-2"
        data-impact-binding={binding}
        disabled={!confirmed || Boolean(disabledReason) || isPending}
        onClick={onConfirm}
        type="button"
        variant={variant}
      >
        {buttonLabel}
      </Button>
      {disabledReason ? (
        <p className="mt-2 text-muted-foreground text-sm" id={explanationId}>
          {disabledReason}
        </p>
      ) : null}
    </section>
  );
}
