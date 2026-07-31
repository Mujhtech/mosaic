import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { addMemberMutationOptions } from "@/features/members/mutations/member-mutations";
import { membersQueryOptions } from "@/features/members/queries/members-query";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";

const ROLE_OPTIONS = [
  { label: "Member", value: "member" },
  { label: "Admin", value: "admin" },
];

export function MembersPage({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const members = useQuery(membersQueryOptions(organizationId));
  const mutation = useMutation(
    addMemberMutationOptions(organizationId, queryClient)
  );
  const items = members.data?.items ?? [];
  const [addOpen, setAddOpen] = useState(false);
  const form = useForm({
    defaultValues: { actorId: "", role: "member" as "admin" | "member" },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        actorId: value.actorId.trim(),
        role: value.role,
      });
      form.reset();
      setAddOpen(false);
    },
  });
  const state = resolveHostedQueryState({
    emptyDescription:
      "Add an existing actor after the approved identity boundary can identify them.",
    emptyTitle: "No additional members",
    error: members.error,
    isEmpty: members.isSuccess && items.length === 0,
    isPending: members.isPending,
    loadingDescription: "Loading organization membership.",
    onRetry: () => {
      members.refetch();
    },
    permissionDescription:
      "Only organization owners and admins can manage memberships.",
  });
  const canManageMembers = state.kind === "empty" || state.kind === "ready";

  const addDialog = (
    <Dialog
      onOpenChange={(open) => {
        setAddOpen(open);
        if (!open) {
          form.reset();
          mutation.reset();
        }
      }}
      open={addOpen}
    >
      <DialogTrigger render={<Button size="sm" />}>Add member</DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>
              Invitations and email delivery remain deferred; this accepts an
              existing Actor ID only.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-4">
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
                  <FieldDescription>
                    Identity-provider-neutral subject ID.
                  </FieldDescription>
                </Field>
              )}
            </form.Field>
            <form.Field name="role">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="member-role">Role</FieldLabel>
                  <Select
                    items={ROLE_OPTIONS}
                    onValueChange={(value) =>
                      field.handleChange(value as "admin" | "member")
                    }
                    value={field.state.value}
                  >
                    <SelectTrigger id="member-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
            {mutation.error ? (
              <p className="text-destructive text-sm" role="alert">
                {mutation.error.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button disabled={mutation.isPending} type="submit">
              {mutation.isPending ? "Adding…" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return (
    <WorkspacePage
      actions={canManageMembers ? addDialog : null}
      description="Membership roles apply across this organization. The final owner can never be removed."
      title="Members"
    >
      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Organization members">
          <ul className="divide-y">
            {items.map((membership) => (
              <li
                className="flex items-center justify-between gap-4 py-3"
                key={membership.actorId}
              >
                <span className="font-mono text-sm">{membership.actorId}</span>
                <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-xs capitalize">
                  {membership.role}
                </span>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}
