import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The confirmation for the one-way upgrade to Protocol 0.4.
 *
 * Two things have to be said plainly, because neither is recoverable by an
 * undo the author might not think to reach for:
 *
 * - the step is one way, and
 * - a 0.3-only SDK will render the paywall **statically** until it upgrades.
 *
 * The second is the `renderWithoutMotion` tier, and it is deliberately phrased
 * as what the customer sees rather than as a capability name: "no motion until
 * the app updates" is the decision the author is actually making. It is not a
 * warning about breakage -- the terminal-state rule guarantees the static
 * rendering is the full authored design -- so the copy says "without motion",
 * not "incorrectly".
 */
export function UpgradeToV04Dialog({
  onConfirm,
  onOpenChange,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upgrade to Protocol 0.4</DialogTitle>
          <DialogDescription>
            This adds motion support to the paywall. It cannot be undone from
            here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-4 text-sm">
          <section aria-labelledby="upgrade-v04-changes">
            <h3 className="font-semibold" id="upgrade-v04-changes">
              What changes
            </h3>
            <ul className="mt-1 list-disc space-y-1 ps-5 text-muted-foreground">
              <li>The paywall moves from Protocol 0.3 to Protocol 0.4.</li>
              <li>
                A Motion section is added to the Design System, so you can
                author durations and easing curves.
              </li>
              <li>
                Feature List markers move to the shared marker vocabulary, which
                lets an item show a cross instead of a tick.
              </li>
            </ul>
          </section>

          <section aria-labelledby="upgrade-v04-rendering">
            <h3 className="font-semibold" id="upgrade-v04-rendering">
              What stays the same
            </h3>
            <p className="mt-1 text-muted-foreground">
              Nothing about the current design changes. The upgrade adds no
              motion on its own, and the paywall renders exactly as it does now
              until you author some.
            </p>
          </section>

          <section aria-labelledby="upgrade-v04-sdks">
            <h3 className="font-semibold" id="upgrade-v04-sdks">
              Apps on older SDKs
            </h3>
            <p className="mt-1 text-muted-foreground">
              An app running a Protocol 0.3 SDK will keep showing this paywall
              in full, but <strong>without motion</strong>, until that app ships
              an SDK that supports 0.4. Every animation ends where the static
              design already is, so those customers see the complete paywall —
              they just do not see it move.
            </p>
          </section>
        </div>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button onClick={onConfirm} type="button">
            Upgrade to 0.4
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
