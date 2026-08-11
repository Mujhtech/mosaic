import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/ssr/UploadSimple";
import { type DragEvent, type ReactNode, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";

/**
 * Write-once secret entry taking the key file itself — the file the store
 * console hands the operator is the source of truth, so there is no paste
 * mode to introduce truncated or reformatted key material.
 *
 * The file is read entirely in the browser into form state — it is never
 * uploaded as a file and never touches storage; only the resulting text is
 * sent once over TLS by the parent form.
 */
export function SecretKeyField({
  accept,
  description,
  errors,
  extra,
  fileKindLabel,
  id,
  label,
  onBlur,
  onChange,
  value,
}: {
  accept: string;
  description: ReactNode;
  errors: readonly string[];
  extra?: ReactNode;
  fileKindLabel: string;
  id: string;
  label: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  value: string;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const invalid = errors.length > 0 || readError !== null;
  const fileLoaded = fileName !== null && value.trim() !== "";

  function readFile(file: File) {
    file
      .text()
      .then((text) => {
        setFileName(file.name);
        setReadError(null);
        onChange(text);
        onBlur();
      })
      .catch(() => {
        setFileName(null);
        setReadError(
          `${file.name} could not be read. Choose the ${fileKindLabel} again.`
        );
        onChange("");
      });
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      readFile(file);
    }
  }

  function clearKey() {
    setFileName(null);
    setReadError(null);
    onChange("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        accept={accept}
        aria-describedby={`${id}-help`}
        aria-invalid={invalid || undefined}
        className="sr-only"
        id={id}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // Reset so re-choosing the same file after a cleared attempt
          // still fires a change event.
          event.currentTarget.value = "";
          if (file) {
            readFile(file);
          }
        }}
        ref={fileInputRef}
        type="file"
      />
      {fileLoaded ? (
        <div
          className="flex items-center justify-center gap-2 rounded border border-input p-3 text-sm"
          data-testid={`${id}-loaded`}
        >
          <CheckCircleIcon
            aria-hidden
            className="size-4 shrink-0 text-emerald-600"
            weight="fill"
          />
          <span className="min-w-0 truncate font-medium">{fileName}</span>
          <span className="text-muted-foreground">key loaded</span>
          <Button onClick={clearKey} size="sm" type="button" variant="ghost">
            Remove
          </Button>
        </div>
      ) : (
        // biome-ignore lint/a11y/noNoninteractiveElementInteractions: drag-and-drop is a pointer-only enhancement; the accessible path is the label's native click-to-open on the associated file input
        <label
          className={`block cursor-pointer space-y-2 rounded border border-dashed p-4 text-center hover:bg-muted/40 ${
            invalid ? "border-destructive" : "border-input"
          }`}
          htmlFor={id}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <UploadSimpleIcon
            aria-hidden
            className="mx-auto size-5 text-muted-foreground"
          />
          <span className="block text-muted-foreground text-sm">
            Drag the {fileKindLabel} here, or
          </span>
          <span className="inline-flex h-8 items-center rounded border border-input bg-background px-3 font-medium text-xs shadow-xs hover:bg-muted">
            Choose file
          </span>
        </label>
      )}
      {readError ? (
        <p className="text-destructive text-sm" role="alert">
          {readError}
        </p>
      ) : null}
      <FieldDescription id={`${id}-help`}>{description}</FieldDescription>
      {extra}
      <FieldError errors={errors.map((message) => ({ message }))} />
    </Field>
  );
}
