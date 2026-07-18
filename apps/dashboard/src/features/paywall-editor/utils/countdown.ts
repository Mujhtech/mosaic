const UTC_COUNTDOWN_INSTANT_PATTERN =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/

const LOCAL_COUNTDOWN_INSTANT_PATTERN =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.0{1,3})?)?$/

function withoutMilliseconds(value: Date) {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z")
}

export function isValidCountdownInstant(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_COUNTDOWN_INSTANT_PATTERN.test(value)) return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && withoutMilliseconds(new Date(milliseconds)) === value
}

export function countdownInstantFromLocalInput(value: string) {
  if (!LOCAL_COUNTDOWN_INSTANT_PATTERN.test(value)) return null
  const withoutFraction = value.replace(/\.0{1,3}$/, "")
  const withSeconds = withoutFraction.length === 16 ? `${withoutFraction}:00` : withoutFraction
  const instant = `${withSeconds}Z`
  return isValidCountdownInstant(instant) ? instant : null
}

export function countdownLocalInputFromInstant(value: string) {
  return isValidCountdownInstant(value) ? value.slice(0, -1) : ""
}

export function currentCountdownInstant(now = Date.now()) {
  return withoutMilliseconds(new Date(now))
}

export function advanceCountdownInstant(value: string, milliseconds: number) {
  if (!isValidCountdownInstant(value) || !Number.isFinite(milliseconds)) return null
  try {
    const next = withoutMilliseconds(new Date(Date.parse(value) + milliseconds))
    return isValidCountdownInstant(next) ? next : null
  } catch {
    return null
  }
}
