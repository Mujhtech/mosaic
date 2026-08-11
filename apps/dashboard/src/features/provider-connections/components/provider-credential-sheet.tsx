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
import {
  AppStoreConnectPrivateKeyField,
  AppStoreConnectTextField,
} from "@/features/provider-connections/components/app-store-connect-credential-fields";
import { providerConnectionLabel } from "@/features/provider-connections/types/provider-connection-view";
import {
  buildAppStoreConnectCredential,
  validateAppStoreConnectPrivateKey,
  validateAppStoreConnectVendorNumber,
  validateRevenueCatCredential,
} from "@/features/provider-connections/types/provider-operation-input";
import {
  validateAppleIssuerId,
  validateAppleKeyId,
} from "@/features/store-connections/types/store-credential-input";
import type { ProviderConnection } from "@/generated/api";

/**
 * Replacement credential entry for an existing connection.
 *
 * The connection already knows its provider, so the sheet renders exactly the
 * field set that provider's credential requires and assembles the same document
 * shape the connect sheet sends. A RevenueCat key entered against an App Store
 * Connect connection is not a state the operator should be able to reach.
 *
 * The secret is cleared in the submit `finally` block on every path.
 */
export function ProviderCredentialSheet({
  action,
  onSubmit,
  provider,
}: {
  action: "reconnect" | "rotate";
  onSubmit: (credential: string) => Promise<void>;
  provider: ProviderConnection["provider"];
}) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const appStoreConnect = provider === "app_store_connect";
  const title =
    action === "rotate"
      ? "Rotate credential"
      : `Reconnect ${providerConnectionLabel(provider)}`;
  const form = useForm({
    defaultValues: {
      credential: "",
      issuerId: "",
      keyId: "",
      privateKey: "",
      vendorNumber: "",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        await onSubmit(
          appStoreConnect
            ? buildAppStoreConnectCredential({
                issuerId: value.issuerId,
                keyId: value.keyId,
                privateKey: value.privateKey,
                vendorNumber: value.vendorNumber,
              })
            : value.credential
        );
        form.reset();
        setOpen(false);
      } catch (error) {
        setSubmitError(
          error instanceof Error ? error.message : `${title} failed.`
        );
      } finally {
        form.setFieldValue("credential", "");
        form.setFieldValue("privateKey", "");
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
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b p-5">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            The replacement credential is validated before it replaces the
            current encrypted one.
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
            {appStoreConnect ? (
              <>
                <form.Field
                  name="privateKey"
                  validators={{
                    onSubmit: ({ value }) =>
                      validateAppStoreConnectPrivateKey(value),
                  }}
                >
                  {(field) => (
                    <AppStoreConnectPrivateKeyField
                      errors={field.state.meta.errors}
                      idPrefix={`provider-${action}`}
                      label="Replacement App Store Connect API key (.p8)"
                      onBlur={field.handleBlur}
                      onChange={field.handleChange}
                      value={field.state.value}
                    />
                  )}
                </form.Field>

                <form.Field
                  name="keyId"
                  validators={{
                    onSubmit: ({ value }) => validateAppleKeyId(value),
                  }}
                >
                  {(field) => (
                    <AppStoreConnectTextField
                      errors={field.state.meta.errors}
                      idPrefix={`provider-${action}`}
                      kind="keyId"
                      onBlur={field.handleBlur}
                      onChange={field.handleChange}
                      value={field.state.value}
                    />
                  )}
                </form.Field>

                <form.Field
                  name="issuerId"
                  validators={{
                    onSubmit: ({ value }) => validateAppleIssuerId(value),
                  }}
                >
                  {(field) => (
                    <AppStoreConnectTextField
                      errors={field.state.meta.errors}
                      idPrefix={`provider-${action}`}
                      kind="issuerId"
                      onBlur={field.handleBlur}
                      onChange={field.handleChange}
                      value={field.state.value}
                    />
                  )}
                </form.Field>

                <form.Field
                  name="vendorNumber"
                  validators={{
                    onSubmit: ({ value }) =>
                      validateAppStoreConnectVendorNumber(value),
                  }}
                >
                  {(field) => (
                    <AppStoreConnectTextField
                      errors={field.state.meta.errors}
                      idPrefix={`provider-${action}`}
                      kind="vendorNumber"
                      onBlur={field.handleBlur}
                      onChange={field.handleChange}
                      value={field.state.value}
                    />
                  )}
                </form.Field>
              </>
            ) : (
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
            )}
            {submitError ? (
              <p className="text-destructive text-sm" role="alert">
                {submitError}{" "}
                {appStoreConnect
                  ? "The key was cleared. Upload the .p8 file again to retry."
                  : "Re-enter the cleared credential to retry."}
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
