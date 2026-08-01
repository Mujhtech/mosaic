import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { StatusPill } from "@/features/billing-ledger/components/billing-chrome";
import { CreateMigrationProgramForm } from "@/features/billing-migrations/components/create-migration-program-form";
import { createMigrationProgramMutationOptions } from "@/features/billing-migrations/mutations/migration-mutations";
import { migrationProgramsQueryOptions } from "@/features/billing-migrations/queries/migration-queries";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query";
import { useOrganizationAccess } from "@/hooks/use-organization-access";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";

export function MigrationProgramsPage({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const access = useOrganizationAccess(organizationId);
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const [programs, environments, applications] = useQueries({
    queries: [
      { ...migrationProgramsQueryOptions(projectId), enabled: scopeReady },
      { ...environmentsQueryOptions(projectId), enabled: scopeReady },
      { ...applicationsQueryOptions(projectId), enabled: scopeReady },
    ],
  });
  const create = useMutation(
    createMigrationProgramMutationOptions(projectId, queryClient)
  );
  const resetMutationCallback = useCallback(() => create.reset(), [create]);
  const [createOpen, setCreateOpen] = useState(false);

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Migration Programs unavailable"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    );
  }

  const items = programs.data ?? [];
  const error =
    project.error ??
    access.error ??
    programs.error ??
    environments.error ??
    applications.error;
  const state = resolveHostedQueryState({
    error,
    isEmpty: false,
    isPending:
      project.isPending ||
      access.isPending ||
      (scopeReady &&
        (programs.isPending ||
          environments.isPending ||
          applications.isPending)),
    loadingDescription:
      "Loading Project migration programs and their available scope.",
    onRetry: () => {
      programs.refetch();
      environments.refetch();
      applications.refetch();
    },
    permissionDescription:
      "Project membership is required to view Migration Programs.",
    scope: { organizationId, projectId },
  });
  const base = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/billing/migrations`;
  const createDialog = (
    <Dialog
      onOpenChange={(open) => {
        setCreateOpen(open);
        if (!open) {
          create.reset();
        }
      }}
      open={createOpen}
    >
      <DialogTrigger render={<Button size="sm" />}>
        Create program
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Migration Program</DialogTitle>
          <DialogDescription>
            {`Creating a program performs a bounded, read-only source capability assessment. The server authorizes the command; Organization role ${access.role ?? "unknown"} is explanatory only.`}
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-4">
          <CreateMigrationProgramForm
            applications={applications.data?.items ?? []}
            environments={environments.data?.items ?? []}
            isPending={create.isPending}
            onCreate={(command) => create.mutateAsync(command)}
            onCreated={(program) => {
              setCreateOpen(false);
              navigate({
                params: (prev) => ({
                  ...prev,
                  ...workspaceScopeParams(prev),
                  programId: program.programId,
                }),
                search: { classification: "all", tab: "overview" },
                to: "/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/migrations/$programId",
              });
            }}
            resetMutation={resetMutationCallback}
          />
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <WorkspacePage
      actions={createDialog}
      description="Plan and inspect a bounded RevenueCat migration without changing billing authority. Source credentials are separately consented, write-only secrets."
      eyebrow="Mosaic Billing"
      title="Migration Programs"
    >
      <HostedResourceBoundary state={state}>
        {items.length === 0 ? (
          <EmptyState
            action={
              <a
                className={buttonVariants({ variant: "outline" })}
                href={`/orgs/${encodeURIComponent(organizationId)}/members`}
              >
                Review authorized operators
              </a>
            }
            description={
              "No RevenueCat migration has been scoped for this Project. Submit a scoped request from Create program; the server will authorize or deny it."
            }
            title="No Migration Programs yet"
          />
        ) : (
          <WorkflowPanel title={`${items.length} Migration Program(s)`}>
            <ul className="divide-y">
              {items.map((detail) => {
                const { program } = detail;
                return (
                  <li
                    className="flex items-center gap-3 py-4"
                    key={program.programId}
                  >
                    <div className="min-w-0 flex-1">
                      <a
                        className="font-semibold text-primary"
                        href={`${base}/${encodeURIComponent(program.programId)}`}
                      >
                        RevenueCat · {program.scope.environmentId}
                      </a>
                      <p className="mt-1 text-muted-foreground text-xs">
                        {program.scope.applications.length} explicit
                        Application/platform scope(s) · state version{" "}
                        {program.stateVersion}
                      </p>
                    </div>
                    <StatusPill
                      label={program.state.replaceAll("_", " ")}
                      tone={
                        program.state === "failed" ||
                        program.state === "cancelled"
                          ? "negative"
                          : "neutral"
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </WorkflowPanel>
        )}
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}
