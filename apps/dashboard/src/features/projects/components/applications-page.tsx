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
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { createApplicationMutationOptions } from "@/features/projects/mutations/project-mutations";
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query";

const PLATFORM_OPTIONS = [
  { label: "iOS", value: "ios" },
  { label: "Android", value: "android" },
];

interface ApplicationsPageProps {
  organizationId: string;
  projectId: string;
}

export function ApplicationsPage({
  organizationId,
  projectId,
}: ApplicationsPageProps) {
  const queryClient = useQueryClient();
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const applications = useQuery({
    ...applicationsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const mutation = useMutation(
    createApplicationMutationOptions(projectId, queryClient)
  );
  const items = applications.data?.items ?? [];
  const [registerOpen, setRegisterOpen] = useState(false);
  const form = useForm({
    defaultValues: {
      identifier: "",
      name: "",
      platform: "ios" as "android" | "ios",
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        identifier: value.identifier.trim(),
        name: value.name.trim(),
        platform: value.platform,
      });
      form.reset();
      setRegisterOpen(false);
    },
  });
  const state = resolveHostedQueryState({
    emptyDescription:
      "Register an iOS bundle ID or Android package identifier. Framework is intentionally not collected.",
    emptyTitle: "No applications registered",
    error: project.error ?? applications.error,
    isEmpty: scopeReady && applications.isSuccess && items.length === 0,
    isPending: project.isPending || (scopeReady && applications.isPending),
    loadingDescription: "Loading project applications.",
    onRetry: () => {
      applications.refetch();
    },
    permissionDescription:
      "Project membership is required to view applications; owner or admin is required to register one.",
  });
  const canManageApplications =
    state.kind === "empty" || state.kind === "ready";

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Applications unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    );
  }

  const registerDialog = (
    <Dialog
      onOpenChange={(open) => {
        setRegisterOpen(open);
        if (!open) {
          form.reset();
          mutation.reset();
        }
      }}
      open={registerOpen}
    >
      <DialogTrigger render={<Button size="sm" />}>
        Register application
      </DialogTrigger>
      <DialogContent aria-describedby="register-application-description">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Register application</DialogTitle>
            <DialogDescription id="register-application-description">
              Register an iOS bundle ID or Android package identifier. Framework
              is intentionally not collected.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-4">
            <form.Field name="name">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="app-name">Name</FieldLabel>
                  <Input
                    id="app-name"
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Acme iOS"
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="platform">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="app-platform">Platform</FieldLabel>
                  <Select
                    items={PLATFORM_OPTIONS}
                    onValueChange={(value) =>
                      field.handleChange(value as "android" | "ios")
                    }
                    value={field.state.value}
                  >
                    <SelectTrigger id="app-platform">
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
                  <FieldDescription>No framework field.</FieldDescription>
                </Field>
              )}
            </form.Field>
            <form.Field name="identifier">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="app-identifier">
                    Bundle or package identifier
                  </FieldLabel>
                  <Input
                    id="app-identifier"
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={
                      field.form.getFieldValue("platform") === "ios"
                        ? "com.example.app"
                        : "dev.example.app"
                    }
                    value={field.state.value}
                  />
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
              {mutation.isPending ? "Registering…" : "Register application"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return (
    <WorkspacePage
      actions={canManageApplications ? registerDialog : null}
      description="Applications are concrete iOS or Android identities and remain project-wide."
      eyebrow="Project-wide"
      title="Applications"
    >
      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Registered applications">
          <ul className="divide-y">
            {items.map((application) => (
              <li
                className="flex items-start justify-between gap-4 py-4"
                key={application.id}
              >
                <span>
                  <span className="block font-semibold text-sm">
                    {application.name}
                  </span>
                  <span className="mt-1 block font-mono text-muted-foreground text-xs">
                    {application.identifier}
                  </span>
                </span>
                <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-xs uppercase">
                  {application.platform}
                </span>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}
