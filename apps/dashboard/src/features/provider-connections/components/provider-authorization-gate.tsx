import { LockKeyIcon } from "@phosphor-icons/react/dist/ssr/LockKey"

import { Button } from "@/components/ui/button"

export function ProviderAuthorizationGate() {
  return (
    <section
      aria-labelledby="provider-authorization-title"
      className="border-border bg-muted/30 rounded border p-5"
      role="status"
    >
      <div className="flex items-start gap-3">
        <span className="bg-background grid size-9 shrink-0 place-items-center rounded border">
          <LockKeyIcon aria-hidden size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Owner decision required
          </p>
          <h2 className="mt-1 text-base font-semibold" id="provider-authorization-title">
            RevenueCat authorization is not enabled yet
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
            Mosaic has an accepted encrypted-envelope design, but the direct RevenueCat
            authorization method still requires approval. No credential is collected, stored in this
            browser, or sent to the API from this screen.
          </p>
          <Button className="mt-4" disabled type="button">
            Connect RevenueCat
          </Button>
        </div>
      </div>
    </section>
  )
}
