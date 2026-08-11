import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SecretKeyField } from "@/features/store-connections/components/secret-key-field";
import {
  validateApplePrivateKey,
  validateGoogleServiceAccount,
} from "@/features/store-connections/types/store-credential-input";

interface RotateStoreCredentialSheetProps {
  onRotate: (secret: string) => Promise<void>;
  provider: "app_store" | "google_play" | undefined;
}

/**
 * Rotation replaces the stored secret and mints a new intake token. The
 * previous endpoint stops resolving immediately — that is the point of rotating
 * after a suspected compromise, and it is also why the consequence is stated
 * before the control rather than after the action.
 */
export function RotateStoreCredentialSheet({
  onRotate,
  provider,
}: RotateStoreCredentialSheetProps) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const apple = provider !== "google_play";

  const form = useForm({
    defaultValues: { secret: "" },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        await onRotate(value.secret);
        form.reset();
        setOpen(false);
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "Mosaic could not rotate this credential."
        );
      } finally {
        form.setFieldValue("secret", "");
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
        Rotate credential
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b p-5">
          <SheetTitle>Rotate Store Server Credential</SheetTitle>
          <SheetDescription>
            {apple
              ? "The stored key is replaced and a new intake token is minted. The previous notification endpoint stops resolving immediately, so App Store Connect must be reconfigured with the new address or notifications stop arriving."
              : "The stored service-account key is replaced. Validation and Pub/Sub pulls use the new key from the next attempt onward."}
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
          <div className="space-y-5 p-5">
            <form.Field
              name="secret"
              validators={{
                onSubmit: ({ value }) =>
                  apple
                    ? validateApplePrivateKey(value)
                    : validateGoogleServiceAccount(value),
              }}
            >
              {(field) => (
                <SecretKeyField
                  accept={apple ? ".p8,.pem" : ".json,application/json"}
                  description="Entered once and cleared after this attempt. Nothing already recorded is removed: the ledger is the evidence a rotation is usually part of investigating."
                  errors={field.state.meta.errors.filter(
                    (message): message is string => typeof message === "string"
                  )}
                  fileKindLabel={
                    apple ? ".p8 key file" : "service-account JSON file"
                  }
                  id="rotate-store-credential-secret"
                  label={
                    apple
                      ? "Replacement In-App Purchase key (.p8)"
                      : "Replacement service-account JSON key"
                  }
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                  value={field.state.value}
                />
              )}
            </form.Field>
            {submitError ? (
              <p className="text-destructive text-sm" role="alert">
                {submitError}
              </p>
            ) : null}
          </div>
          <SheetFooter className="border-t p-5">
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button
                  disabled={isSubmitting}
                  type="submit"
                  variant="destructive"
                >
                  {isSubmitting ? "Rotating…" : "Rotate credential"}
                </Button>
              )}
            </form.Subscribe>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
