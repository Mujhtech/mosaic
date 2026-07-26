import type { AnalyticsFilters } from "./analytics"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const LOCALE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/

function utcDate(offsetDays: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

export function defaultAnalyticsFilters(): AnalyticsFilters {
  return {
    from: utcDate(-29),
    to: utcDate(0),
    timezone: "UTC",
    basis: "event_count",
  }
}

export function parseAnalyticsFilters(search: Record<string, unknown>): AnalyticsFilters {
  const defaults = defaultAnalyticsFilters()
  const from =
    typeof search.from === "string" && ISO_DATE.test(search.from) ? search.from : defaults.from
  const to = typeof search.to === "string" && ISO_DATE.test(search.to) ? search.to : defaults.to
  return {
    from: from <= to ? from : defaults.from,
    to: from <= to ? to : defaults.to,
    timezone:
      typeof search.timezone === "string" && search.timezone.length <= 64 ? search.timezone : "UTC",
    basis: "event_count",
    platform:
      search.platform === "ios" || search.platform === "android" ? search.platform : undefined,
    locale:
      typeof search.locale === "string" && LOCALE.test(search.locale) ? search.locale : undefined,
    applicationVersion:
      typeof search.applicationVersion === "string" && search.applicationVersion.length <= 64
        ? search.applicationVersion
        : undefined,
  }
}

export function serializeAnalyticsFilters(filters: AnalyticsFilters) {
  return {
    from: filters.from,
    to: filters.to,
    timezone: filters.timezone,
    basis: filters.basis,
    platform: filters.platform,
    locale: filters.locale,
    applicationVersion: filters.applicationVersion,
  }
}
