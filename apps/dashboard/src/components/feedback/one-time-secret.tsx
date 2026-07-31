import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import { useCallback, useId, useState } from "react";

import { Button } from "@/components/ui/button";

interface OneTimeSecretProps {
  /** Label for the copy control. Name the thing being copied, not "value". */
  copyLabel?: string;
  description?: string;
  dismissLabel?: string;
  eyebrow?: string;
  onDismiss: () => void;
  secret: string;
  title?: string;
  writeToClipboard?: (value: string) => Promise<void>;
}

/**
 * A value the API returns exactly once. Two surfaces need it — API-key secrets
 * and Store Notification intake endpoints — so it is a generic feedback
 * primitive rather than a feature component.
 *
 * The value is held only in the caller's local state: it must never be written
 * to the Query cache, a route search parameter, or browser storage. Dismissal
 * unmounts it, and nothing can render it again.
 */
export function OneTimeSecret({
  copyLabel = "Copy secret",
  description = "Mosaic cannot show this secret again after you dismiss it.",
  dismissLabel = "Dismiss one-time secret",
  eyebrow = "One-time secret",
  onDismiss,
  secret,
  title = "Copy this key now",
  writeToClipboard = (value) => navigator.clipboard.writeText(value),
}: OneTimeSecretProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const titleId = useId();

  const copySecret = useCallback(async () => {
    try {
      await writeToClipboard(secret);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }, [secret, writeToClipboard]);

  const handleClick = useCallback(() => {
    copySecret();
  }, [copySecret]);
  return (
    <section
      aria-labelledby={titleId}
      className="rounded border border-primary/30 bg-primary/5 p-5"
      role="status"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-xs uppercase tracking-wide">
            {eyebrow}
          </p>
          <h2 className="mt-1 font-semibold text-lg" id={titleId}>
            {title}
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">{description}</p>
        </div>
        <Button
          aria-label={dismissLabel}
          onClick={onDismiss}
          size="icon"
          variant="ghost"
        >
          <XIcon aria-hidden size={17} />
        </Button>
      </div>
      {/* Selectable as the manual fallback: clipboard access is unavailable
          outside secure contexts and in some browsers. */}
      <code className="mt-4 block select-all overflow-x-auto break-all rounded border bg-background p-3 text-sm">
        {secret}
      </code>
      <Button className="mt-3" onClick={handleClick} variant="outline">
        <CopyIcon aria-hidden size={16} />
        {copied ? "Copied" : copyLabel}
      </Button>
      <p aria-live="polite" className="mt-2 text-muted-foreground text-xs">
        {copyFailed
          ? "Copying failed. Select the value above to copy it manually."
          : ""}
      </p>
    </section>
  );
}
