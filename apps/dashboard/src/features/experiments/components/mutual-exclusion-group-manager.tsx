import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { useExperimentAdapter } from "../api/use-experiment-adapter"
import {
  createExperimentGroupMutationOptions,
  createExperimentGroupVersionMutationOptions,
} from "../mutations/experiment-mutations"
import {
  experimentGroupsQueryOptions,
  experimentGroupVersionsQueryOptions,
  experimentsQueryOptions,
} from "../queries/experiment-queries"
import { validateMutualExclusionAllocation, type ExperimentScope } from "../types/experiment"

export function MutualExclusionGroupManager({ scope }: { scope: ExperimentScope }) {
  const adapter = useExperimentAdapter()
  const queryClient = useQueryClient()
  const experiments = useQuery(experimentsQueryOptions(scope, adapter))
  const groups = useQuery(experimentGroupsQueryOptions(scope, adapter))
  const createGroup = useMutation(createExperimentGroupMutationOptions(scope, adapter, queryClient))
  const eligible = experiments.data ?? []
  const [selectedGroupId, setSelectedGroupId] = useState("")
  const [selected, setSelected] = useState<readonly string[]>([])
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [localError, setLocalError] = useState<string>()
  const versions = useQuery(experimentGroupVersionsQueryOptions(scope, selectedGroupId, adapter))
  const createVersion = useMutation(
    createExperimentGroupVersionMutationOptions(scope, selectedGroupId, adapter, queryClient),
  )
  const form = useForm({
    defaultValues: {
      assignmentKeyPolicy: "identified_user" as const,
      holdoutPercent: "0",
      name: "",
    },
    onSubmit: async ({ value, formApi }) => {
      const holdoutBasisPoints = Math.round(Number(value.holdoutPercent) * 100)
      const members = selected.map((experimentId) => ({
        allocationBasisPoints: Math.round(Number(allocations[experimentId] ?? 0) * 100),
        experimentId,
      }))
      const allocationError = validateMutualExclusionAllocation(members, holdoutBasisPoints)
      if (allocationError) throw new Error(allocationError)
      const scientificDefinition = {
        assignmentKeyPolicy: value.assignmentKeyPolicy,
        holdoutBasisPoints,
        members,
      }
      if (selectedGroupId) {
        await createVersion.mutateAsync(scientificDefinition)
      } else {
        if (!value.name.trim()) throw new Error("Enter a group name.")
        await createGroup.mutateAsync({ ...scientificDefinition, name: value.name.trim() })
      }
      formApi.reset()
      setSelected([])
      setAllocations({})
    },
  })

  function toggle(experimentId: string) {
    setSelected((current) => {
      const next = current.includes(experimentId)
        ? current.filter((id) => id !== experimentId)
        : [...current, experimentId]
      const even = next.length ? 100 / next.length : 0
      setAllocations(Object.fromEntries(next.map((id) => [id, even.toFixed(2)])))
      return next
    })
  }

  function beginVersion(groupId = "") {
    setSelectedGroupId(groupId)
    setSelected([])
    setAllocations({})
    setLocalError(undefined)
    createGroup.reset()
    createVersion.reset()
    form.reset()
  }

  const selectedGroup = groups.data?.find((group) => group.id === selectedGroupId)
  const pending = createGroup.isPending || createVersion.isPending

  return (
    <WorkflowPanel
      title="Mutual-exclusion groups"
      description="Create Experiment drafts first, define immutable group membership over their stable Experiment IDs, then attach the Group Version to each draft before publishing. Group allocation is independent of Variant allocation and explicitly includes normal-Placement holdout."
    >
      <details>
        <summary className="focus-visible:ring-ring cursor-pointer rounded text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none">
          Manage groups ({groups.data?.length ?? 0})
        </summary>
        <form
          className="mt-4 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setLocalError(undefined)
            void form
              .handleSubmit()
              .catch((error: unknown) =>
                setLocalError(
                  error instanceof Error
                    ? error.message
                    : "The group Version could not be created.",
                ),
              )
          }}
        >
          {groups.data?.length ? (
            <ul aria-label="Existing mutual-exclusion groups" className="grid gap-2">
              {groups.data.map((group) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
                  key={group.id}
                >
                  <div>
                    <strong>{group.name}</strong>
                    <span className="text-muted-foreground ml-2">
                      Active Version {group.versionId}
                    </span>
                  </div>
                  <Button
                    onClick={() => beginVersion(group.id)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Create next Version
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {selectedGroup ? (
            <div className="bg-muted/20 rounded border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  New immutable Version for {selectedGroup.name}
                </p>
                <Button onClick={() => beginVersion()} size="sm" type="button" variant="ghost">
                  Create a different group
                </Button>
              </div>
              {versions.data?.length ? (
                <ol
                  aria-label="Immutable group Version history"
                  className="text-muted-foreground mt-2 flex flex-wrap gap-2 text-xs"
                >
                  {versions.data.map((version) => (
                    <li className="rounded border px-2 py-1" key={version.id}>
                      v{version.versionNumber} · {version.members.length} members ·{" "}
                      {(version.holdoutBasisPoints / 100).toFixed(2)}% holdout
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <form.Field name="name">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="group-name">Group name</FieldLabel>
                  <Input
                    disabled={Boolean(selectedGroup)}
                    id="group-name"
                    value={selectedGroup?.name ?? field.state.value}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="assignmentKeyPolicy">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="group-policy">Group assignment identity</FieldLabel>
                  <select
                    className="border-input bg-background h-8 rounded border px-2 text-sm"
                    id="group-policy"
                    value={field.state.value}
                    onChange={(event) =>
                      field.handleChange(event.currentTarget.value as typeof field.state.value)
                    }
                  >
                    <option value="identified_user">Identified user</option>
                    <option value="identified_user_or_installation">
                      Identified user, otherwise installation
                    </option>
                    <option value="installation">Installation</option>
                  </select>
                </Field>
              )}
            </form.Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold">Experiment members</legend>
            {eligible.length ? (
              eligible.map((experiment) => {
                const experimentId = experiment.id
                const checked = selected.includes(experimentId)
                return (
                  <div
                    className="grid gap-2 rounded border p-3 sm:grid-cols-[1fr_11rem] sm:items-center"
                    key={experiment.id}
                  >
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        checked={checked}
                        onChange={() => toggle(experimentId)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{experiment.name}</strong>
                        <span className="text-muted-foreground ml-2">
                          {experiment.status === "draft"
                            ? "Draft root"
                            : `Stable root · ${experiment.status}`}
                        </span>
                      </span>
                    </label>
                    <Field>
                      <FieldLabel className="sr-only" htmlFor={`group-allocation-${experiment.id}`}>
                        Group allocation for {experiment.name}
                      </FieldLabel>
                      <Input
                        disabled={!checked}
                        id={`group-allocation-${experiment.id}`}
                        min="0.01"
                        step="0.01"
                        type="number"
                        value={allocations[experimentId] ?? "0"}
                        onChange={(event) =>
                          setAllocations((current) => ({
                            ...current,
                            [experimentId]: event.currentTarget.value,
                          }))
                        }
                      />
                      <p className="text-muted-foreground text-xs">
                        % · {Math.round(Number(allocations[experimentId] ?? 0) * 100)} bp
                      </p>
                    </Field>
                  </div>
                )
              })
            ) : (
              <p className="text-muted-foreground text-sm">
                Create at least two Experiment drafts before creating a group.
              </p>
            )}
          </fieldset>
          <form.Field name="holdoutPercent">
            {(field) => (
              <Field className="max-w-48">
                <FieldLabel htmlFor="group-holdout">Normal Placement holdout (%)</FieldLabel>
                <Input
                  id="group-holdout"
                  min="0"
                  max="99.99"
                  step="0.01"
                  type="number"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                />
                <p className="text-muted-foreground text-xs">
                  {Math.round(Number(field.state.value || 0) * 100)} basis points
                </p>
              </Field>
            )}
          </form.Field>
          <p className="text-muted-foreground text-xs">
            Group Versions reference stable Experiment IDs, not published Experiment Versions. A new
            Group Version never mutates history. Failure of the selected Experiment uses normal
            Placement; it never selects another member.
          </p>
          {localError || createGroup.error || createVersion.error ? (
            <p className="text-destructive text-sm" role="alert">
              {createGroup.error?.message ?? createVersion.error?.message ?? localError}
            </p>
          ) : null}
          {createGroup.data ? (
            <p className="text-sm font-medium" role="status">
              Created {createGroup.data.name} with immutable group Version{" "}
              {createGroup.data.versionId}.
            </p>
          ) : null}
          {createVersion.data ? (
            <p className="text-sm font-medium" role="status">
              Created immutable group Version {createVersion.data.versionNumber}.
            </p>
          ) : null}
          <Button className="w-fit" disabled={pending || eligible.length < 2} type="submit">
            {pending
              ? "Creating…"
              : selectedGroup
                ? "Create next immutable Version"
                : "Create group and first Version"}
          </Button>
        </form>
      </details>
    </WorkflowPanel>
  )
}
