import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr/Archive"
import { LockKeyIcon } from "@phosphor-icons/react/dist/ssr/LockKey"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/feedback/empty-state"
import { ErrorState } from "@/components/feedback/error-state"
import { LoadingState } from "@/components/feedback/loading-state"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { PlacementDecisionsAdapter } from "@/features/placement-decisions/api/placement-decisions-adapter"
import { createAttributeMutationOptions } from "@/features/placement-decisions/mutations/placement-decision-mutations"
import {
  attributeDefinitionsQueryOptions,
  placementDecisionKeys,
} from "@/features/placement-decisions/queries/placement-decision-queries"
import type {
  AttributeDefinition,
  AttributeType,
  ConditionOperator,
} from "@/features/placement-decisions/types/placement-decision"

const ATTRIBUTE_KEY = /^[a-z][a-z0-9_]{0,63}$/
const DEFAULT_OPERATORS: readonly ConditionOperator[] = [
  "equals",
  "not_equals",
  "exists",
  "does_not_exist",
]

const ATTRIBUTE_TYPE_OPTIONS = [
  "string",
  "boolean",
  "number",
  "timestamp",
  "semantic_version",
  "string_list",
].map((type) => ({ label: type.replace("_", " "), value: type }))

const SENSITIVITY_OPTIONS = [
  { label: "Standard", value: "standard" },
  { label: "Sensitive", value: "sensitive" },
]

export function AttributeDefinitions({
  adapter,
  projectId,
}: {
  adapter: PlacementDecisionsAdapter
  projectId: string
}) {
  const queryClient = useQueryClient()
  const attributes = useQuery(attributeDefinitionsQueryOptions(projectId, adapter))
  const create = useMutation(createAttributeMutationOptions(projectId, adapter, queryClient))
  const archive = useMutation({
    mutationFn: (attributeId: string) => adapter.archiveAttribute(projectId, attributeId),
    onSuccess: (_, attributeId) =>
      queryClient.setQueryData<readonly AttributeDefinition[]>(
        placementDecisionKeys.attributes(projectId, adapter),
        (current) =>
          current?.map((item) =>
            item.id === attributeId ? { ...item, status: "archived" } : item,
          ) ?? [],
      ),
  })
  const form = useForm({
    defaultValues: {
      description: "",
      key: "",
      sensitivity: "standard" as "standard" | "sensitive",
      type: "string" as AttributeType,
    },
    onSubmit: async ({ value, formApi }) => {
      await create.mutateAsync({ ...value, allowedOperators: DEFAULT_OPERATORS })
      formApi.reset()
    },
  })

  if (attributes.isPending)
    return <LoadingState description="Loading Project attribute definitions." />
  if (attributes.error)
    return (
      <ErrorState
        description={attributes.error.message}
        onRetry={() => void attributes.refetch()}
      />
    )

  return (
    <section aria-labelledby="attributes-heading" className="space-y-4">
      <div>
        <h2 className="text-base font-semibold" id="attributes-heading">
          Attribute definitions
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Allow-list typed keys for local SDK targeting. Mosaic stores definitions, never customer
          values.
        </p>
      </div>
      <form
        className="border-border grid gap-3 rounded border p-4 lg:grid-cols-[1fr_1fr_1fr_1.5fr_auto] lg:items-start"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <form.Field
          name="key"
          validators={{
            onSubmit: ({ value }) =>
              ATTRIBUTE_KEY.test(value)
                ? undefined
                : "Use lowercase letters, numbers, and underscores.",
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="attribute-key">Key</FieldLabel>
              <Input
                id="attribute-key"
                onChange={(event) => field.handleChange(event.currentTarget.value.toLowerCase())}
                placeholder="student"
                value={field.state.value}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>
        <form.Field name="type">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="attribute-type">Type</FieldLabel>
              <Select
                items={ATTRIBUTE_TYPE_OPTIONS}
                onValueChange={(value) => field.handleChange(value as AttributeType)}
                value={field.state.value}
              >
                <SelectTrigger id="attribute-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ATTRIBUTE_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>
        <form.Field name="sensitivity">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="attribute-sensitivity">Sensitivity</FieldLabel>
              <Select
                items={SENSITIVITY_OPTIONS}
                onValueChange={(value) => field.handleChange(value as "standard" | "sensitive")}
                value={field.state.value}
              >
                <SelectTrigger id="attribute-sensitivity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SENSITIVITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>
        <form.Field name="description">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="attribute-description">Internal description</FieldLabel>
              <Input
                id="attribute-description"
                maxLength={256}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>
        <Button className="lg:mt-6" disabled={create.isPending} type="submit">
          {create.isPending ? "Creating…" : "Add definition"}
        </Button>
        {create.error ? (
          <p className="text-destructive text-sm lg:col-span-5" role="alert">
            {create.error.message}
          </p>
        ) : null}
      </form>

      {attributes.data.length === 0 ? (
        <EmptyState
          description="Create an allow-listed key before using user attributes in Rules."
          title="No attribute definitions"
        />
      ) : (
        <ul className="divide-border rounded border">
          {attributes.data.map((attribute) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 p-4"
              key={attribute.id}
            >
              <div>
                <p className="flex items-center gap-2 font-mono text-sm">
                  {attribute.key}
                  {attribute.sensitivity === "sensitive" ? (
                    <LockKeyIcon aria-label="Sensitive" />
                  ) : null}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {attribute.type.replace("_", " ")} · {attribute.usageCount} Rule references ·
                  revision {attribute.revision}
                </p>
                {attribute.description ? (
                  <p className="mt-1 text-sm">{attribute.description}</p>
                ) : null}
              </div>
              {attribute.status === "active" ? (
                <Button
                  disabled={archive.isPending}
                  onClick={() => archive.mutate(attribute.id)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ArchiveIcon aria-hidden /> Archive
                </Button>
              ) : (
                <span className="text-muted-foreground text-xs">Archived</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {archive.error ? (
        <p className="text-destructive text-sm" role="alert">
          {archive.error.message}
        </p>
      ) : null}
    </section>
  )
}
