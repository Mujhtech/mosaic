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
 * - a 0.3-only SDK is refused a 0.4 release **entirely** -- it does not
 *   receive this paywall at all until the app ships a 0.4-capable SDK.
 *
 * The second must not be softened into the `renderWithoutMotion` story. That
 * tier degrades *within* a version: a reader that already advertises 0.4 but
 * lacks a motion capability renders the full static design. A reader that
 * does not advertise 0.4 never reaches that tier -- delivery refuses the
 * whole release through the ordinary rejectDocument flow (pinned by the
 * backend's TestV04ReleaseIsRefusedToAProtocol03OnlyReader), because no 0.3
 * projection of a 0.4 release exists. So the copy states the audience impact
 * as the decision actually being made: 0.3 apps stop receiving new versions
 * of this paywall, while versions already published on 0.3 keep serving
 * unchanged.
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
              Once you publish on 0.4, apps running a Protocol 0.3 SDK{" "}
              <strong>will not receive this paywall at all</strong> — not even a
              static version — until they ship an SDK that supports Protocol
              0.4. Versions of this paywall already published on 0.3 keep
              serving to those apps exactly as they are.
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
