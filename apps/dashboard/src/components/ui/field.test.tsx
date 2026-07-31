import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/**
 * Mosaic wires the description and error text to the field control from the
 * field root, rather than threading identifiers through every one of the many
 * control components in use. That wiring is Mosaic-owned logic: if it breaks,
 * every form in the dashboard silently loses its accessible description and
 * validation announcement, with no visual symptom.
 */
describe("Field accessibility association", () => {
  it("associates the description, and the error only while it is shown", () => {
    const { rerender } = render(
      <Field>
        <FieldLabel htmlFor="api-key-name">Key name</FieldLabel>
        <Input id="api-key-name" />
        <FieldDescription>Shown to your team in the API key list.</FieldDescription>
        <FieldError errors={[]} />
      </Field>,
    )

    const input = screen.getByLabelText("Key name")
    const description = screen.getByText("Shown to your team in the API key list.")

    expect(description.id).not.toBe("")
    expect(input.getAttribute("aria-describedby")).toBe(description.id)

    rerender(
      <Field>
        <FieldLabel htmlFor="api-key-name">Key name</FieldLabel>
        <Input id="api-key-name" />
        <FieldDescription>Shown to your team in the API key list.</FieldDescription>
        <FieldError errors={[{ message: "A key name is required." }]} />
      </Field>,
    )

    const error = screen.getByRole("alert")
    expect(error.id).not.toBe("")
    expect(input.getAttribute("aria-describedby")?.split(" ")).toEqual([description.id, error.id])

    // Once the error clears, its identifier must not linger as a dangling
    // reference to a removed element.
    rerender(
      <Field>
        <FieldLabel htmlFor="api-key-name">Key name</FieldLabel>
        <Input id="api-key-name" />
        <FieldDescription>Shown to your team in the API key list.</FieldDescription>
        <FieldError errors={[]} />
      </Field>,
    )

    expect(input.getAttribute("aria-describedby")).toBe(description.id)
  })

  it("keeps a hand-written aria-describedby written by a feature form", () => {
    render(
      <Field>
        <FieldLabel htmlFor="credential">Secret</FieldLabel>
        <Input aria-describedby="credential-note" id="credential" />
        <FieldDescription>Encrypted by the API.</FieldDescription>
        <p id="credential-note">Never returned once saved.</p>
      </Field>,
    )

    const input = screen.getByLabelText("Secret")
    const described = input.getAttribute("aria-describedby")?.split(" ") ?? []

    expect(described).toContain("credential-note")
    expect(described).toContain(screen.getByText("Encrypted by the API.").id)
  })
})
