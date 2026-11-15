/**
 * Display-name rule, shared with the backend (backend/app/usernames.py):
 * trimmed, 2 to 30 characters, Unicode letters and single spaces only.
 */

export const MIN_USERNAME_LENGTH = 2;
export const MAX_USERNAME_LENGTH = 30;

export function validateUsername(
  value: string,
  options?: { required?: boolean },
): string | null {
  const required = options?.required !== false;
  const name = value.trim();
  if (!name) {
    return required
      ? `Name must be between ${MIN_USERNAME_LENGTH} and ${MAX_USERNAME_LENGTH} characters.`
      : null;
  }
  if (name.length < MIN_USERNAME_LENGTH || name.length > MAX_USERNAME_LENGTH) {
    return `Name must be between ${MIN_USERNAME_LENGTH} and ${MAX_USERNAME_LENGTH} characters.`;
  }
  const words = name.split(" ");
  if (words.some((word) => word === "")) {
    return "Use single spaces between the words.";
  }
  if (!words.every((word) => /^\p{L}+$/u.test(word))) {
    return "Only letters and single spaces are allowed.";
  }
  return null;
}
