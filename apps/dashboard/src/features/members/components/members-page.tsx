import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { addMemberMutationOptions } from "@/features/members/mutations/member-mutations"
import { membersQueryOptions } from "@/features/members/queries/members-query"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"

export function MembersPage({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient()
  const members = useQuery(membersQueryOptions(organizationId))
  const mutation = useMutation(addMemberMutationOptions(organizationId, queryClient))
  const items = members.data?.items ?? []
  const form = useForm({
    defaultValues: { actorId: "", role: "member" as "admin" | "member" },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({ actorId: value.actorId.trim(), role: value.role })
      form.reset()
    },
  })
  const state = resolveHostedQueryState({
    emptyDescription:
      "Add an existing actor after the approved identity boundary can identify them.",
    emptyTitle: "No additional members",
    error: members.error,
    isEmpty: members.isSuccess && items.length === 0,
    isPending: members.isPending,
    loadingDescription: "Loading organization membership.",
    onRetry: () => void members.refetch(),
    permissionDescription: "Only organization owners and admins can manage memberships.",
  })
  const canManageMembers = state.kind === "empty" || state.kind === "ready"

  return (
    <WorkspacePage
      description="Membership roles apply across this organization. The final owner can never be removed."
      title="Members"
    >
      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Organization members">
          <ul className="divide-y">
            {items.map((membership) => (
              <li className="flex items-center justify-between gap-4 py-3" key={membership.actorId}>
                <span className="font-mono text-sm">{membership.actorId}</span>
                <span className="bg-muted rounded-full px-2.5 py-1 text-xs font-medium capitalize">
                  {membership.role}
                </span>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
      {canManageMembers ? (
        <WorkflowPanel
          description="Invitations and email delivery remain deferred; this accepts an existing Actor ID only."
          title="Add member"
        >
          <form
            className="grid max-w-2xl gap-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void form.handleSubmit()
            }}
          >
            <form.Field name="actorId">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="member-actor-id">Actor ID</FieldLabel>
                  <Input
                    id="member-actor-id"
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="actor_…"
                    value={field.state.value}
                  />
                  <FieldDescription>Identity-provider-neutral subject ID.</FieldDescription>
                </Field>
              )}
            </form.Field>
            <form.Field name="role">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="member-role">Role</FieldLabel>
                  <select
                    className="border-input bg-background h-9 rounded border px-3 text-sm"
                    id="member-role"
                    onChange={(event) =>
                      field.handleChange(event.target.value as "admin" | "member")
                    }
                    value={field.state.value}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </Field>
              )}
            </form.Field>
            <Button disabled={mutation.isPending} type="submit">
              {mutation.isPending ? "Adding…" : "Add member"}
            </Button>
          </form>
          {mutation.error ? (
            <p className="text-destructive mt-4 text-sm" role="alert">
              {mutation.error.message}
            </p>
          ) : null}
        </WorkflowPanel>
      ) : null}
    </WorkspacePage>
  )
}
