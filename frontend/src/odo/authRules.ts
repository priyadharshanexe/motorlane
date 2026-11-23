// Inline validation rules for the auth forms (the server re-validates everything).
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validate(name: string, value: string) {
  if (name === "email") return !value ? "Enter your email." : EMAIL.test(value) ? "" : "That doesn't look like an email address.";
  if (name === "password") return !value ? "Enter a password." : value.length < 8 ? "Use at least 8 characters." : "";
  return "";
}

/** Password strength for the fuel gauge, 0-4: length (8, 12), mixed case, digits plus symbols. */
export function strength(value: string) {
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
  return Math.min(4, score);
}
