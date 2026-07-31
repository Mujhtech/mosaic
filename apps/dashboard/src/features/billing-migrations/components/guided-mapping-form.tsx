import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BillingMigrationMappingEntry } from "@/generated/api";

type MappingEntry = BillingMigrationMappingEntry;
const sourceKinds: MappingEntry["sourceKind"][] = [
  "customer_id",
  "original_customer_id",
  "audited_alias",
  "product",
  "entitlement",
];
const sourceKindOptions = sourceKinds.map((kind) => ({
  label: kind.replaceAll("_", " "),
  value: kind,
}));

const MATCH_KIND_OPTIONS = [
  { label: "Exact", value: "exact" },
  { label: "Audited alias", value: "audited_alias" },
];

/**
 * Rows carry their own identity because they are added and removed freely. Keyed
 * by position instead, React would reuse a removed row's DOM — and its focus and
 * caret — for whichever row slid into its place.
 */
interface MappingRow {
  entry: MappingEntry;
  id: string;
}

const emptyRow = (): MappingRow => ({
  entry: {
    matchKind: "exact",
    sourceIdentifier: "",
    sourceKind: "product",
    targetId: "",
  },
  id: crypto.randomUUID(),
});

interface RowError {
  source: string;
  target: string;
}

interface Props {
  isPending: boolean;
  onCreate: (entries: MappingEntry[]) => Promise<unknown>;
}

function MappingRowFields({
  canRemove,
  entry,
  error,
  id,
  isPending,
  onChange,
  onRemove,
  position,
}: {
  canRemove: boolean;
  entry: MappingEntry;
  error?: RowError;
  id: string;
  isPending: boolean;
  onChange: (id: string, patch: Partial<MappingEntry>) => void;
  onRemove: (id: string) => void;
  position: number;
}) {
  const handleSourceKind = useCallback(
    (value: string) =>
      onChange(id, { sourceKind: value as MappingEntry["sourceKind"] }),
    [id, onChange]
  );
  const handleSourceIdentifier = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      onChange(id, { sourceIdentifier: event.target.value }),
    [id, onChange]
  );
  const handleMatchKind = useCallback(
    (value: string) =>
      onChange(id, { matchKind: value as MappingEntry["matchKind"] }),
    [id, onChange]
  );
  const handleTargetId = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      onChange(id, { targetId: event.target.value }),
    [id, onChange]
  );
  const handleRemove = useCallback(() => onRemove(id), [id, onRemove]);
  const sourceInputId = `mapping-${id}-source`;
  const targetInputId = `mapping-${id}-target`;

  return (
    <fieldset className="rounded border p-3">
      <legend className="px-1 font-semibold text-sm">Mapping {position}</legend>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="font-medium text-xs">
          <span className="block">Source kind</span>
          <Select
            items={sourceKindOptions}
            onValueChange={handleSourceKind}
            value={entry.sourceKind}
          >
            <SelectTrigger
              aria-label={`Mapping ${position} source kind`}
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
        <label className="font-medium text-xs" htmlFor={sourceInputId}>
          Source identifier
          <Input
            aria-invalid={Boolean(error?.source)}
            className="mt-1"
            id={sourceInputId}
            onChange={handleSourceIdentifier}
            value={entry.sourceIdentifier}
          />
          {error?.source ? (
            <span className="mt-1 block text-destructive" role="alert">
              {error.source}
            </span>
          ) : null}
        </label>
        <div className="font-medium text-xs">
          <span className="block">Match</span>
          <Select
            items={MATCH_KIND_OPTIONS}
            onValueChange={handleMatchKind}
            value={entry.matchKind}
          >
            <SelectTrigger
              aria-label={`Mapping ${position} match kind`}
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
        <label className="font-medium text-xs" htmlFor={targetInputId}>
          Mosaic target ID
          <Input
            aria-invalid={Boolean(error?.target)}
            className="mt-1"
            id={targetInputId}
            onChange={handleTargetId}
            value={entry.targetId}
          />
          {error?.target ? (
            <span className="mt-1 block text-destructive" role="alert">
              {error.target}
            </span>
          ) : null}
        </label>
      </div>
      {canRemove ? (
        <Button
          className="mt-3"
          disabled={isPending}
          onClick={handleRemove}
          size="sm"
          type="button"
          variant="outline"
        >
          Remove mapping {position}
        </Button>
      ) : null}
    </fieldset>
  );
}

export function GuidedMappingForm({ isPending, onCreate }: Props) {
  const [rows, setRows] = useState<MappingRow[]>([emptyRow()]);
  const [reviewing, setReviewing] = useState(false);
  const errors = useMemo(
    () =>
      rows.map(({ entry }) => ({
        source: entry.sourceIdentifier.trim()
          ? ""
          : "Enter the exact source identifier.",
        target: entry.targetId.trim() ? "" : "Enter the Mosaic target ID.",
      })),
    [rows]
  );
  const valid = errors.every((entry) => !(entry.source || entry.target));

  const update = useCallback((id: string, patch: Partial<MappingEntry>) => {
    setReviewing(false);
    setRows((current) =>
      current.map((row) =>
        row.id === id ? { ...row, entry: { ...row.entry, ...patch } } : row
      )
    );
  }, []);

  const remove = useCallback((id: string) => {
    setReviewing(false);
    setRows((current) => current.filter((row) => row.id !== id));
  }, []);

  const add = useCallback(() => {
    setReviewing(false);
    setRows((current) => [...current, emptyRow()]);
  }, []);

  const review = useCallback(() => setReviewing(true), []);

  const create = useCallback(
    () =>
      onCreate(
        rows.map(({ entry }) => ({
          ...entry,
          sourceIdentifier: entry.sourceIdentifier.trim(),
          targetId: entry.targetId.trim(),
        }))
      ),
    [onCreate, rows]
  );

  return (
    <div className="space-y-4">
      <p className="rounded border border-dashed p-3 text-muted-foreground text-sm">
        Enter source identifiers from normalized, assessed source evidence only.
        Source-row browsing and Mosaic target pickers are deferred until
        verified manifest ingestion and list APIs are available; do not infer or
        transform identifiers here.
      </p>
      <div className="space-y-3">
        {rows.map((row, index) => (
          <MappingRowFields
            canRemove={rows.length > 1}
            entry={row.entry}
            error={errors[index]}
            id={row.id}
            isPending={isPending}
            key={row.id}
            onChange={update}
            onRemove={remove}
            position={index + 1}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={isPending}
          onClick={add}
          type="button"
          variant="outline"
        >
          Add mapping
        </Button>
        <Button disabled={isPending || !valid} onClick={review} type="button">
          Review mapping set
        </Button>
      </div>
      {reviewing ? (
        <section
          aria-labelledby="mapping-review-title"
          className="rounded border bg-muted/50 p-4"
        >
          <h3 className="font-semibold" id="mapping-review-title">
            Review before creating
          </h3>
          <p className="mt-1 text-muted-foreground text-sm">
            This draft contains {rows.length} explicit mapping(s). Review every
            source and target before creating an immutable version later.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {rows.map(({ entry, id }) => (
              <li key={id}>
                {entry.sourceKind.replaceAll("_", " ")}{" "}
                <code>{entry.sourceIdentifier}</code> →{" "}
                <code>{entry.targetId}</code> (
                {entry.matchKind.replaceAll("_", " ")})
              </li>
            ))}
          </ul>
          <Button
            className="mt-3"
            disabled={isPending}
            onClick={create}
            type="button"
          >
            Create reviewed draft
          </Button>
        </section>
      ) : null}
    </div>
  );
}
