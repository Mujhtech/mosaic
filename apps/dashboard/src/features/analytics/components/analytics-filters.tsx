import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnalyticsFilters as Filters } from "../types/analytics";

const TIMEZONE_OPTIONS = [
  { label: "UTC", value: "UTC" },
  { label: "America/Los Angeles", value: "America/Los_Angeles" },
  { label: "America/New York", value: "America/New_York" },
  { label: "Europe/London", value: "Europe/London" },
  { label: "Africa/Lagos", value: "Africa/Lagos" },
  { label: "Asia/Tokyo", value: "Asia/Tokyo" },
];

const PLATFORM_OPTIONS = [
  { label: "All platforms", value: "" },
  { label: "iOS", value: "ios" },
  { label: "Android", value: "android" },
];

interface Props {
  filters: Filters;
  onChange: (filters: Filters) => void;
}

export function AnalyticsFilters({ filters, onChange }: Props) {
  return (
    <form
      aria-label="Analytics filters"
      className="grid gap-3 rounded border border-border bg-muted/20 p-4 sm:grid-cols-2 xl:grid-cols-6"
      key={JSON.stringify(filters)}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const platform = data.get("platform");
        onChange({
          from: String(data.get("from")),
          to: String(data.get("to")),
          timezone: String(data.get("timezone")),
          basis: "event_count",
          platform:
            platform === "ios" || platform === "android" ? platform : undefined,
          locale: String(data.get("locale") || "") || undefined,
          applicationVersion:
            String(data.get("applicationVersion") || "") || undefined,
        });
      }}
    >
      <FilterField label="From" name="from" type="date" value={filters.from} />
      <FilterField label="To" name="to" type="date" value={filters.to} />
      <div className="space-y-1 font-medium text-xs">
        <label htmlFor="analytics-timezone">Timezone</label>
        <Select
          defaultValue={filters.timezone}
          items={TIMEZONE_OPTIONS}
          name="timezone"
        >
          <SelectTrigger id="analytics-timezone" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1 font-medium text-xs">
        <label htmlFor="analytics-platform">Platform</label>
        <Select
          defaultValue={filters.platform ?? ""}
          items={PLATFORM_OPTIONS}
          name="platform"
        >
          <SelectTrigger id="analytics-platform" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLATFORM_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <FilterField
        label="Locale"
        name="locale"
        placeholder="en-US"
        value={filters.locale ?? ""}
      />
      <FilterField
        label="App version"
        name="applicationVersion"
        placeholder="1.4.0"
        value={filters.applicationVersion ?? ""}
      />
      <p className="self-end text-muted-foreground text-xs sm:col-span-2 xl:col-span-5">
        Metric basis: accepted, deduplicated event counts · 24-hour
        exact-correlation window
      </p>
      <Button className="self-end" type="submit" variant="outline">
        Apply filters
      </Button>
    </form>
  );
}

const fieldClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-9 w-full rounded border px-3 text-sm outline-none focus-visible:ring-3";

function FilterField({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="space-y-1 font-medium text-xs">
      {label}
      <input className={fieldClass} {...props} />
    </label>
  );
}
