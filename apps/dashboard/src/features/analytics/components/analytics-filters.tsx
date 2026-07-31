import { Button } from "@/components/ui/button"
import type { AnalyticsFilters as Filters } from "../types/analytics"

interface Props {
  filters: Filters
  onChange: (filters: Filters) => void
}

export function AnalyticsFilters({ filters, onChange }: Props) {
  return (
    <form
      aria-label="Analytics filters"
      className="border-border bg-muted/20 grid gap-3 rounded border p-4 sm:grid-cols-2 xl:grid-cols-6"
      key={JSON.stringify(filters)}
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const platform = data.get("platform")
        onChange({
          from: String(data.get("from")),
          to: String(data.get("to")),
          timezone: String(data.get("timezone")),
          basis: "event_count",
          platform: platform === "ios" || platform === "android" ? platform : undefined,
          locale: String(data.get("locale") || "") || undefined,
          applicationVersion: String(data.get("applicationVersion") || "") || undefined,
        })
      }}
    >
      <FilterField label="From" name="from" type="date" value={filters.from} />
      <FilterField label="To" name="to" type="date" value={filters.to} />
      <label className="space-y-1 text-xs font-medium">
        Timezone
        <select className={fieldClass} defaultValue={filters.timezone} name="timezone">
          <option value="UTC">UTC</option>
          <option value="America/Los_Angeles">America/Los Angeles</option>
          <option value="America/New_York">America/New York</option>
          <option value="Europe/London">Europe/London</option>
          <option value="Africa/Lagos">Africa/Lagos</option>
          <option value="Asia/Tokyo">Asia/Tokyo</option>
        </select>
      </label>
      <label className="space-y-1 text-xs font-medium">
        Platform
        <select className={fieldClass} defaultValue={filters.platform ?? ""} name="platform">
          <option value="">All platforms</option>
          <option value="ios">iOS</option>
          <option value="android">Android</option>
        </select>
      </label>
      <FilterField label="Locale" name="locale" placeholder="en-US" value={filters.locale ?? ""} />
      <FilterField
        label="App version"
        name="applicationVersion"
        placeholder="1.4.0"
        value={filters.applicationVersion ?? ""}
      />
      <p className="text-muted-foreground self-end text-xs sm:col-span-2 xl:col-span-5">
        Metric basis: accepted, deduplicated event counts · 24-hour exact-correlation window
      </p>
      <Button className="self-end" type="submit" variant="outline">
        Apply filters
      </Button>
    </form>
  )
}

const fieldClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-9 w-full rounded border px-3 text-sm outline-none focus-visible:ring-3"

function FilterField({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="space-y-1 text-xs font-medium">
      {label}
      <input className={fieldClass} {...props} />
    </label>
  )
}
