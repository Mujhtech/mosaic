import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import {
  type LocalProjectReadResult,
  parseImportedJson,
  readLocalProjectResult,
} from "@/features/paywall-editor/mutations/local-project-file";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import {
  createPaywallWithDraftMutationOptions,
  PaywallCreatedWithoutDraftError,
} from "@/features/paywalls/mutations/paywall-mutations";
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter";
import { studioScopeParams } from "@/lib/routing/workspace-params";

const KEY_PATTERN = /^[a-z][a-z0-9_-]{1,62}$/;
const starterDocument = EDITOR_TEMPLATES[0].document;

type DraftSource = "file" | "local" | "template";

export function CreatePaywallDraftForm({
  environmentId,
  projectId,
}: {
  environmentId: string;
  projectId: string;
}) {
  const fieldIds = useId();
  const adapter = useHostedPublishingAdapter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [localProject, setLocalProject] = useState<LocalProjectReadResult>({
    status: "empty",
  });
  const [fileDocument, setFileDocument] = useState<MosaicDocument | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const mutation = useMutation(
    createPaywallWithDraftMutationOptions(
      { environmentId, projectId },
      adapter,
      queryClient
    )
  );
  const form = useForm({
    defaultValues: { key: "", name: "", source: "template" as DraftSource },
    onSubmit: async ({ value }) => {
      const document = (() => {
        if (
          value.source === "local" &&
          (localProject.status === "valid" ||
            localProject.status === "recoverable")
        ) {
          return localProject.project.document;
        }
        if (value.source === "file") {
          return fileDocument;
        }
        return starterDocument;
      })();
      if (!document) {
        setFileError(
          "Choose a valid Mosaic JSON file before creating this Draft."
        );
        return;
      }
      try {
        const partial =
          mutation.error instanceof PaywallCreatedWithoutDraftError
            ? mutation.error
            : null;
        const result = await mutation.mutateAsync({
          document: partial?.document ?? cloneValue(document),
          existingPaywall: partial?.paywall,
          key: value.key.trim(),
          name: value.name.trim(),
        });
        await navigate({
          params: (prev) => ({
            ...prev,
            ...studioScopeParams(prev),
            environmentId,
            draftId: result.draft.id,
            paywallId: result.paywall.id,
          }),
          to: "/studio/$organizationId/$projectId/$environmentId/$paywallId/$draftId",
        });
      } catch {
        // The mutation renders either a retryable partial result or the safe API error below.
      }
    },
  });

  useEffect(() => {
    const timer = window.setTimeout(
      () => setLocalProject(readLocalProjectResult()),
      0
    );
    return () => window.clearTimeout(timer);
  }, []);

  async function selectFile(file: File) {
    try {
      const parsed = parseImportedJson(await file.text());
      setFileDocument(parsed.document);
      setFileError(null);
      form.setFieldValue("source", "file");
    } catch (error) {
      setFileDocument(null);
      setFileError(
        error instanceof Error
          ? error.message
          : "The file could not be imported."
      );
    }
  }

  const hasLocalProject =
    localProject.status === "valid" || localProject.status === "recoverable";

  return (
    <form
      className="space-y-5"
      id="create-paywall"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <form.Field
          name="name"
          validators={{
            onBlur: ({ value }) =>
              value.trim() ? undefined : "Enter a paywall name.",
            onSubmit: ({ value }) =>
              value.trim() ? undefined : "Enter a paywall name.",
          }}
        >
          {(field) => (
            <Field
              data-invalid={field.state.meta.errors.length > 0 || undefined}
            >
              <FieldLabel htmlFor="paywall-name">Paywall name</FieldLabel>
              <Input
                aria-invalid={field.state.meta.errors.length > 0 || undefined}
                id="paywall-name"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder="Onboarding upgrade"
                value={field.state.value}
              />
              <FieldError
                errors={field.state.meta.errors.map((message) => ({ message }))}
              />
            </Field>
          )}
        </form.Field>
        <form.Field
          name="key"
          validators={{
            onBlur: ({ value }) =>
              KEY_PATTERN.test(value.trim())
                ? undefined
                : "Start with a letter and use lowercase letters, numbers, underscores, or hyphens.",
            onSubmit: ({ value }) =>
              KEY_PATTERN.test(value.trim())
                ? undefined
                : "Enter a valid, project-unique paywall key.",
          }}
        >
          {(field) => (
            <Field
              data-invalid={field.state.meta.errors.length > 0 || undefined}
            >
              <FieldLabel htmlFor="paywall-key">Paywall key</FieldLabel>
              <Input
                aria-invalid={field.state.meta.errors.length > 0 || undefined}
                id="paywall-key"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value.toLowerCase())
                }
                placeholder="onboarding_upgrade"
                value={field.state.value}
              />
              <FieldDescription>
                Stable and unique within this Project.
              </FieldDescription>
              <FieldError
                errors={field.state.meta.errors.map((message) => ({ message }))}
              />
            </Field>
          )}
        </form.Field>
      </div>

      <form.Field name="source">
        {(field) => (
          <fieldset className="space-y-3">
            <legend className="font-medium text-sm">
              Initial Draft source
            </legend>
            <label className="flex items-start gap-3 rounded border border-border p-3 text-sm">
              <input
                checked={field.state.value === "template"}
                className="mt-0.5 accent-primary"
                name={field.name}
                onChange={() => field.handleChange("template")}
                type="radio"
              />
              <span>
                <span className="block font-medium">Starter paywall</span>
                <span className="mt-1 block text-muted-foreground">
                  Create a hosted copy from Mosaic’s starter template.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded border border-border p-3 text-sm">
              <input
                checked={field.state.value === "local"}
                className="mt-0.5 accent-primary"
                disabled={!hasLocalProject}
                name={field.name}
                onChange={() => field.handleChange("local")}
                type="radio"
              />
              <span>
                <span className="block font-medium">
                  Copy saved Local Studio work
                </span>
                <span className="mt-1 block text-muted-foreground">
                  {hasLocalProject
                    ? "Copies the browser’s local Draft; the local source stays unchanged."
                    : "Open Local Studio and save a Draft on this device first."}
                </span>
              </span>
            </label>
            <label
              className="block rounded border border-border p-3 text-sm"
              htmlFor={`${fieldIds}-field-1`}
            >
              <span className="block font-medium">Import Mosaic JSON</span>
              <span className="mt-1 block text-muted-foreground">
                A valid Protocol 0.2 paywall is copied into a new hosted Draft.
              </span>
              <Input
                accept="application/json,.json"
                className="mt-3"
                id={`${fieldIds}-field-1`}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) {
                    selectFile(file);
                  }
                }}
                type="file"
              />
              {fileDocument ? (
                <span className="mt-2 block text-primary text-xs" role="status">
                  Ready to import {fileDocument.id}.
                </span>
              ) : null}
            </label>
          </fieldset>
        )}
      </form.Field>

      {fileError || mutation.error ? (
        <div
          className="rounded border border-destructive/25 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="text-destructive text-sm">
            {fileError ?? mutation.error?.message}
          </p>
          {mutation.error instanceof PaywallCreatedWithoutDraftError ? (
            <p className="mt-1 text-muted-foreground text-xs">
              The Paywall is safe and visible in this Project. Submit again to
              retry only its first Draft.
            </p>
          ) : null}
        </div>
      ) : null}
      <form.Subscribe
        selector={(state) => [state.canSubmit, state.isSubmitting]}
      >
        {([canSubmit, isSubmitting]) => (
          <Button
            disabled={!canSubmit || isSubmitting || mutation.isPending}
            type="submit"
          >
            {(() => {
              if (mutation.isPending) {
                return "Creating hosted Draft…";
              }
              if (mutation.error instanceof PaywallCreatedWithoutDraftError) {
                return "Retry first Draft";
              }
              return "Create paywall and hosted Draft";
            })()}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
