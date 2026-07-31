export function validatePassword(value: string, isSignup: boolean) {
  const minimumLength = isSignup ? 12 : 1;
  if (value.length < minimumLength) {
    return isSignup ? "Use at least 12 characters." : "Enter your password.";
  }
}
