import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { BillingMigrationMappingEntry } from "@/generated/api"

type MappingEntry = BillingMigrationMappingEntry
const sourceKinds: MappingEntry["sourceKind"][] = [
  "customer_id",
  "original_customer_id",
  "audited_alias",
  "product",
  "entitlement",
]
const sourceKindOptions = sourceKinds.map((kind) => ({
  label: kind.replaceAll("_", " "),
  value: kind,
}))

const MATCH_KIND_OPTIONS = [
  { label: "Exact", value: "exact" },
  { label: "Audited alias", value: "audited_alias" },
]
const emptyRow = (): MappingEntry => ({
  matchKind: "exact",
  sourceIdentifier: "",
  sourceKind: "product",
  targetId: "",
})

interface Props {
  isPending: boolean
  onCreate: (entries: MappingEntry[]) => Promise<unknown>
}

export function GuidedMappingForm({ isPending, onCreate }: Props) {
  const [entries, setEntries] = useState<MappingEntry[]>([emptyRow()])
  const [reviewing, setReviewing] = useState(false)
  const errors = useMemo(
    () =>
      entries.map((entry) => ({
        source: entry.sourceIdentifier.trim() ? "" : "Enter the exact source identifier.",
        target: entry.targetId.trim() ? "" : "Enter the Mosaic target ID.",
      })),
    [entries],
  )
  const valid = errors.every((entry) => !entry.source && !entry.target)

  function update(index: number, patch: Partial<MappingEntry>) {
    setReviewing(false)
    setEntries((current) =>
      current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...patch } : entry)),
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground rounded border border-dashed p-3 text-sm">
        Enter source identifiers from normalized, assessed source evidence only. Source-row browsing
        and Mosaic target pickers are deferred until verified manifest ingestion and list APIs are
        available; do not infer or transform identifiers here.
      </p>
      <div className="space-y-3">
        {entries.map((entry, index) => (
          <fieldset className="rounded border p-3" key={index}>
            <legend className="px-1 text-sm font-semibold">Mapping {index + 1}</legend>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="text-xs font-medium">
                <span className="block">Source kind</span>
                <Select
                  items={sourceKindOptions}
                  onValueChange={(value) =>
                    update(index, { sourceKind: value as MappingEntry["sourceKind"] })
                  }
                  value={entry.sourceKind}
                >
                  <SelectTrigger
                    aria-label={`Mapping ${index + 1} source kind`}
                    className="mt-1"
                    size="sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceKindOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="text-xs font-medium">
                Source identifier
                <Input
                  aria-invalid={Boolean(errors[index]?.source)}
                  className="mt-1"
                  onChange={(event) => update(index, { sourceIdentifier: event.target.value })}
                  value={entry.sourceIdentifier}
                />
                {errors[index]?.source ? (
                  <span className="text-destructive mt-1 block" role="alert">
                    {errors[index].source}
                  </span>
                ) : null}
              </label>
              <div className="text-xs font-medium">
                <span className="block">Match</span>
                <Select
                  items={MATCH_KIND_OPTIONS}
                  onValueChange={(value) =>
                    update(index, { matchKind: value as MappingEntry["matchKind"] })
                  }
                  value={entry.matchKind}
                >
                  <SelectTrigger
                    aria-label={`Mapping ${index + 1} match kind`}
                    className="mt-1"
                    size="sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MATCH_KIND_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="text-xs font-medium">
                Mosaic target ID
                <Input
                  aria-invalid={Boolean(errors[index]?.target)}
                  className="mt-1"
                  onChange={(event) => update(index, { targetId: event.target.value })}
                  value={entry.targetId}
                />
                {errors[index]?.target ? (
                  <span className="text-destructive mt-1 block" role="alert">
                    {errors[index].target}
                  </span>
                ) : null}
              </label>
            </div>
            {entries.length > 1 ? (
              <Button
                className="mt-3"
                disabled={isPending}
                onClick={() => {
                  setReviewing(false)
                  setEntries((current) => current.filter((_, entryIndex) => entryIndex !== index))
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Remove mapping {index + 1}
              </Button>
            ) : null}
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={isPending}
          onClick={() => {
            setReviewing(false)
            setEntries((current) => [...current, emptyRow()])
          }}
          type="button"
          variant="outline"
        >
          Add mapping
        </Button>
        <Button disabled={isPending || !valid} onClick={() => setReviewing(true)} type="button">
          Review mapping set
        </Button>
      </div>
      {reviewing ? (
        <section aria-labelledby="mapping-review-title" className="bg-muted/50 rounded border p-4">
          <h3 className="font-semibold" id="mapping-review-title">
            Review before creating
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            This draft contains {entries.length} explicit mapping(s). Review every source and target
            before creating an immutable version later.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {entries.map((entry, index) => (
              <li key={index}>
                {entry.sourceKind.replaceAll("_", " ")} <code>{entry.sourceIdentifier}</code> →{" "}
                <code>{entry.targetId}</code> ({entry.matchKind.replaceAll("_", " ")})
              </li>
            ))}
          </ul>
          <Button
            className="mt-3"
            disabled={isPending}
            onClick={() =>
              void onCreate(
                entries.map((entry) => ({
                  ...entry,
                  sourceIdentifier: entry.sourceIdentifier.trim(),
                  targetId: entry.targetId.trim(),
                })),
              )
            }
            type="button"
          >
            Create reviewed draft
          </Button>
        </section>
      ) : null}
    </div>
  )
}
