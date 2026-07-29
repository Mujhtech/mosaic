import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  customerIdentifierTypes,
  describeSearchIssue,
  identifierTypeHelp,
  identifierTypeLabel,
  MAX_IDENTIFIER_LENGTH,
  SEARCH_HELPER_TEXT,
  SEARCH_PRIVACY_NOTE,
  validateCustomerSearch,
  type CustomerIdentifierType,
} from "@/features/billing-customers/types/customer-search"

const fieldClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-9 w-full rounded border px-3 text-sm outline-none focus-visible:ring-3"

interface CustomerSearchFormProps {
  isPending: boolean
  onSearch: (input: {
    identifierType: CustomerIdentifierType
    identifierValue: string
  }) => Promise<void>
}

/**
 * Typed-identifier lookup.
 *
 * The identifier type is chosen before the value is typed, and the helper text
 * names every accepted identifier. Both are deliberate: an unlabelled box is a
 * box operators put email addresses into, and Mosaic Billing holds no email
 * addresses to match them against. Saying what is accepted is how this control
 * says what does not exist.
 */
export function CustomerSearchForm({ isPending, onSearch }: CustomerSearchFormProps) {
  const [identifierType, setIdentifierType] = useState<CustomerIdentifierType>(
    "billing_customer_id",
  )
  const [identifierValue, setIdentifierValue] = useState("")
  const [issue, setIssue] = useState<string | undefined>(undefined)

  async function submit() {
    const found = validateCustomerSearch({ identifierType, identifierValue })
    if (found) {
      setIssue(describeSearchIssue(found))
      return
    }
    setIssue(undefined)
    await onSearch({ identifierType, identifierValue: identifierValue.trim() })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-muted-foreground text-xs leading-5">{SEARCH_HELPER_TEXT}</p>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-end">
        <Field>
          <FieldLabel htmlFor="customer-identifier-type">Identifier type</FieldLabel>
          <select
            className={fieldClass}
            id="customer-identifier-type"
            onChange={(event) => {
              setIdentifierType(event.currentTarget.value as CustomerIdentifierType)
              setIssue(undefined)
            }}
            value={identifierType}
          >
            {customerIdentifierTypes.map((type) => (
              <option key={type} value={type}>
                {identifierTypeLabel(type)}
              </option>
            ))}
          </select>
        </Field>

        <Field data-invalid={issue !== undefined}>
          <FieldLabel htmlFor="customer-identifier-value">
            {identifierTypeLabel(identifierType)}
          </FieldLabel>
          <Input
            aria-invalid={issue !== undefined}
            autoComplete="off"
            id="customer-identifier-value"
            maxLength={MAX_IDENTIFIER_LENGTH}
            onChange={(event) => {
              const value = event.currentTarget.value
              setIdentifierValue(value)
              setIssue(undefined)
            }}
            value={identifierValue}
          />
          <FieldDescription>{identifierTypeHelp(identifierType)}</FieldDescription>
          {issue ? <FieldError errors={[{ message: issue }]} /> : null}
        </Field>

        <Button disabled={isPending} type="submit">
          {isPending ? "Looking up…" : "Look up"}
        </Button>
      </div>

      <p className="text-muted-foreground text-xs leading-5">{SEARCH_PRIVACY_NOTE}</p>
    </form>
  )
}
