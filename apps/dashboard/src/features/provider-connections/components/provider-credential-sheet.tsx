import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { validateRevenueCatCredential } from "@/features/provider-connections/types/provider-operation-input";

export function ProviderCredentialSheet({
  action,
  onSubmit,
}: {
  action: "reconnect" | "rotate";
  onSubmit: (credential: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const title =
    action === "rotate" ? "Rotate credential" : "Reconnect RevenueCat";
  const form = useForm({
    defaultValues: { credential: "" },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        await onSubmit(value.credential);
        setOpen(false);
      } catch (error) {
        setSubmitError(
          error instanceof Error ? error.message : `${title} failed.`
        );
      } finally {
        form.setFieldValue("credential", "");
      }
    },
  });

  return (
    <Sheet
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setSubmitError(null);
        if (!nextOpen) {
          form.reset();
        }
      }}
      open={open}
    >
      <SheetTrigger render={<Button type="button" variant="outline" />}>
        {title}
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader className="border-b p-5">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            The replacement secret is validated before it replaces the current
            encrypted credential.
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <div className="p-5">
            <form.Field
              name="credential"
              validators={{
                onSubmit: ({ value }) => validateRevenueCatCredential(value),
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor={`provider-${action}-credential`}>
                    New RevenueCat secret API key
                  </FieldLabel>
                  <Input
                    aria-invalid={field.state.meta.errors.length > 0}
                    autoComplete="off"
                    id={`provider-${action}-credential`}
                    onChange={(event) =>
                      field.handleChange(event.currentTarget.value)
                    }
                    spellCheck={false}
                    type="password"
                    value={field.state.value}
                  />
                  <FieldDescription>
                    Cleared after this attempt and never returned or shown
                    again.
                  </FieldDescription>
                  <FieldError
                    errors={field.state.meta.errors.map((message) => ({
                      message,
                    }))}
                  />
                </Field>
              )}
            </form.Field>
            {submitError ? (
              <p className="mt-4 text-destructive text-sm" role="alert">
                {submitError} Re-enter the cleared credential to retry.
              </p>
            ) : null}
          </div>
          <SheetFooter className="border-t p-5">
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting ? "Validating…" : `${title}`}
                </Button>
              )}
            </form.Subscribe>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
