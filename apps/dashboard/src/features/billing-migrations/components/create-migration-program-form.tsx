import { useForm } from "@tanstack/react-form";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createMigrationCommandKey } from "@/features/billing-migrations/mutations/migration-mutations";
import { migrationErrorCopy } from "@/features/billing-migrations/types/migration-operations";
import type {
  Application,
  BillingMigrationProgram,
  CreateBillingMigrationProgramRequestWritable,
  Environment,
} from "@/generated/api";

interface Props {
  applications: readonly Application[];
  environments: readonly Environment[];
  isPending: boolean;
  onCreate: (command: {
    body: CreateBillingMigrationProgramRequestWritable;
    idempotencyKey: string;
  }) => Promise<BillingMigrationProgram>;
  onCreated: (program: BillingMigrationProgram) => void;
  resetMutation: () => void;
}

export function CreateMigrationProgramForm({
  applications,
  environments,
  isPending,
  onCreate,
  onCreated,
  resetMutation,
}: Props) {
  const environmentOptions = [
    { label: "Choose an Environment", value: "" },
    ...environments.map((item) => ({ label: item.name, value: item.id })),
  ];
  const submitting = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      applicationIds: [] as string[],
      environmentId: "",
      revenueCatApiKey: "",
      revenueCatProjectId: "",
      rollbackWindowDays: 7,
      stabilizationDays: 7,
    },
    onSubmit: async ({ value }) => {
      if (submitting.current) {
        return;
      }
      submitting.current = true;
      setSubmitError(null);
      try {
        const program = await onCreate({
          body: {
            applications: value.applicationIds.map((applicationId) => {
              const application = applications.find(
                (item) => item.id === applicationId
              );
              if (!application) {
                throw new Error("invalid_scope");
              }
              return { applicationId, platform: application.platform };
            }),
            environmentId: value.environmentId,
            revenueCatApiKey: value.revenueCatApiKey,
            revenueCatProjectId: value.revenueCatProjectId.trim(),
            rollbackWindowDays: value.rollbackWindowDays,
            stabilizationDays: value.stabilizationDays,
          },
          idempotencyKey: createMigrationCommandKey(),
        });
        form.reset();
        onCreated(program);
      } catch (error) {
        setSubmitError(migrationErrorCopy(error, "create"));
      } finally {
        form.setFieldValue("revenueCatApiKey", "");
        resetMutation();
        submitting.current = false;
      }
    },
  });

  return (
    <form
      className="grid max-w-3xl gap-4 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field
        name="environmentId"
        validators={{
          onSubmit: ({ value }) =>
            value ? undefined : "Choose an Environment.",
        }}
      >
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor="migration-environment">Environment</FieldLabel>
            <Select
              items={environmentOptions}
              onValueChange={(value) => field.handleChange(value)}
              value={field.state.value}
            >
              <SelectTrigger id="migration-environment" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {environmentOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError
              errors={field.state.meta.errors.map((message) => ({ message }))}
            />
          </Field>
        )}
      </form.Field>
      <form.Field
        name="revenueCatProjectId"
        validators={{
          onSubmit: ({ value }) =>
            value.trim() ? undefined : "Enter the RevenueCat Project ID.",
        }}
      >
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor="migration-source-project">
              RevenueCat Project ID
            </FieldLabel>
            <Input
              id="migration-source-project"
              onChange={(event) => field.handleChange(event.target.value)}
              value={field.state.value}
            />
            <FieldError
              errors={field.state.meta.errors.map((message) => ({ message }))}
            />
          </Field>
        )}
      </form.Field>
      <form.Field
        name="revenueCatApiKey"
        validators={{
          onSubmit: ({ value }) =>
            value ? undefined : "Enter a least-privilege migration key.",
        }}
      >
        {(field) => (
          <Field
            className="md:col-span-2"
            data-invalid={field.state.meta.errors.length > 0}
          >
            <FieldLabel htmlFor="migration-source-key">
              RevenueCat migration API key
            </FieldLabel>
            <Input
              autoComplete="off"
              id="migration-source-key"
              onChange={(event) => field.handleChange(event.target.value)}
              type="password"
              value={field.state.value}
            />
            <FieldDescription>
              Cleared after every submission and never read back.
            </FieldDescription>
            <FieldError
              errors={field.state.meta.errors.map((message) => ({ message }))}
            />
          </Field>
        )}
      </form.Field>
      <form.Field
        name="applicationIds"
        validators={{
          onSubmit: ({ value }) =>
            value.length
              ? undefined
              : "Select at least one Application/platform scope.",
        }}
      >
        {(field) => (
          <Field
            className="md:col-span-2"
            data-invalid={field.state.meta.errors.length > 0}
          >
            <FieldLabel>Application/platform scope</FieldLabel>
            <FieldDescription>
              Choose every Application and platform explicitly. Mosaic does not
              infer or wildcard this scope.
            </FieldDescription>
            <div className="grid gap-2 rounded border p-3 sm:grid-cols-2">
              {applications.map((application) => (
                <label
                  className="flex items-center gap-2 text-sm"
                  key={application.id}
                >
                  <input
                    checked={field.state.value.includes(application.id)}
                    onChange={(event) =>
                      field.handleChange(
                        event.currentTarget.checked
                          ? [...field.state.value, application.id]
                          : field.state.value.filter(
                              (id) => id !== application.id
                            )
                      )
                    }
                    type="checkbox"
                  />
                  {application.name} · {application.platform}
                </label>
              ))}
            </div>
            <FieldError
              errors={field.state.meta.errors.map((message) => ({ message }))}
            />
          </Field>
        )}
      </form.Field>
      {submitError ? (
        <p className="text-destructive text-sm md:col-span-2" role="alert">
          {submitError}
        </p>
      ) : null}
      <div className="md:col-span-2">
        <Button disabled={isPending} type="submit">
          {isPending ? "Checking source…" : "Create and check source"}
        </Button>
      </div>
    </form>
  );
}
