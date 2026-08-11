import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SecretKeyField } from "@/features/store-connections/components/secret-key-field";

/**
 * The App Store Connect API key fields, shared by the connect sheet and the
 * rotate/reconnect sheet so the copy, accessible wiring, and upload-only rule
 * cannot drift between the two places an operator enters this credential.
 *
 * These stay presentational: each owning sheet keeps its own TanStack Form
 * instance and passes one field's state in.
 */

interface ControlledFieldProps {
  errors: readonly unknown[];
  idPrefix: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  value: string;
}

const TEXT_FIELD_COPY = {
  issuerId: {
    description:
      "The team-wide issuer UUID at the top of the Keys page. Not a secret.",
    label: "Issuer ID",
    placeholder: "00000000-0000-0000-0000-000000000000",
    slug: "issuer-id",
  },
  keyId: {
    description:
      "Shown beside the key on App Store Connect · Users and Access · Integrations. Not a secret.",
    label: "Key ID",
    placeholder: "ABCDE12345",
    slug: "key-id",
  },
  vendorNumber: {
    description:
      "Not used by catalog import. Find it in App Store Connect · Payments and Financial Reports. Mosaic stores it now so a later sales or price reporting feature does not ask you to re-enter this whole credential.",
    label: "Vendor number (optional)",
    placeholder: "85200000",
    slug: "vendor-number",
  },
} as const;

function messages(errors: readonly unknown[]): string[] {
  return errors.filter(
    (message): message is string => typeof message === "string"
  );
}

/**
 * Upload-only. The file App Store Connect hands the operator is the source of
 * truth, so there is no paste mode to introduce truncated or reformatted key
 * material.
 */
export function AppStoreConnectPrivateKeyField({
  errors,
  idPrefix,
  label,
  onBlur,
  onChange,
  value,
}: ControlledFieldProps & { label: string }) {
  return (
    <SecretKeyField
      accept=".p8,.pem"
      description="Read in this browser, sent once over TLS, encrypted by the API, cleared from this form after the attempt, and never returned or shown again. Mosaic checks only the file format here; Apple decides whether the key works."
      errors={messages(errors)}
      fileKindLabel=".p8 key file"
      id={`${idPrefix}-app-store-connect-private-key`}
      label={label}
      onBlur={onBlur}
      onChange={onChange}
      value={value}
    />
  );
}

export function AppStoreConnectTextField({
  errors,
  idPrefix,
  kind,
  onBlur,
  onChange,
  value,
}: ControlledFieldProps & { kind: keyof typeof TEXT_FIELD_COPY }) {
  const copy = TEXT_FIELD_COPY[kind];
  const fieldMessages = messages(errors);
  const id = `${idPrefix}-app-store-connect-${copy.slug}`;
  return (
    <Field data-invalid={fieldMessages.length > 0}>
      <FieldLabel htmlFor={id}>{copy.label}</FieldLabel>
      <Input
        aria-invalid={fieldMessages.length > 0}
        id={id}
        inputMode={kind === "vendorNumber" ? "numeric" : undefined}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={copy.placeholder}
        spellCheck={false}
        value={value}
      />
      <FieldDescription>{copy.description}</FieldDescription>
      <FieldError errors={fieldMessages.map((message) => ({ message }))} />
    </Field>
  );
}
