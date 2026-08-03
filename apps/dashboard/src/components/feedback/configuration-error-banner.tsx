import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";

import { dashboardEnvironment } from "@/config/environment";

/**
 * A deployment-level misconfiguration, stated in the product.
 *
 * Without it, a dashboard deployed with a missing or typo'd API host silently
 * pointed itself at `http://localhost:8080` and presented the resulting flood
 * of failed requests as an API outage. The operator's next hour goes into the
 * wrong system. This is the one banner that outranks connectivity, because
 * connectivity is exactly what it would otherwise be mistaken for.
 *
 * It renders nothing when configuration is sound, so it costs a boolean read on
 * every page.
 */
export function ConfigurationErrorBanner() {
  if (!dashboardEnvironment.apiBaseUrlMisconfigured) {
    return null;
  }

  return (
    <div
      className="flex items-start justify-center gap-2 border-destructive/30 border-b bg-destructive/10 px-4 py-2 text-foreground text-sm"
      data-slot="configuration-error-banner"
      role="alert"
    >
      <WarningIcon aria-hidden className="mt-0.5 shrink-0" size={16} />
      <span>
        This Mosaic dashboard has no API address configured, so it is using a
        local-development default that cannot work here. Every request will
        fail. Set <code>MOSAIC_DASHBOARD_API_BASE_URL</code> on the dashboard
        deployment and reload. This is a deployment setting, not a network
        problem or an outage.
      </span>
    </div>
  );
}
