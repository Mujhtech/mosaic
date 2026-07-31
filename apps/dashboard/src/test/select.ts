import { fireEvent, screen } from "@testing-library/react"

/**
 * Chooses an option from a `Select`.
 *
 * The trigger is a button and the list renders in a portal, so a value cannot
 * be set with `fireEvent.change` the way a native `<select>` allowed: the list
 * has to be opened before its options exist in the document at all.
 *
 * The option needs the whole pointer sequence, not a bare click. Base UI
 * commits the choice on pointer release so that press-drag-release over the
 * list picks an item, and a lone `click` leaves the value untouched — silently,
 * which is what makes it worth stating here.
 */
export async function chooseSelectOption(trigger: HTMLElement, optionName: string | RegExp) {
  fireEvent.click(trigger)
  const option = await screen.findByRole("option", { name: optionName })
  fireEvent.pointerDown(option)
  fireEvent.pointerUp(option)
  fireEvent.click(option)
}
