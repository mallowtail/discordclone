export type Validated = { ok: true; value: string } | { ok: false; error: string };

export function validateMessage(input: string): Validated {
  const value = input.trim();
  if (value.length === 0) return { ok: false, error: "Message is empty" };
  if (value.length > 2000) return { ok: false, error: "Message too long (max 2000)" };
  return { ok: true, value };
}

export function validateUsername(input: string): Validated {
  const value = input.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(value)) {
    return { ok: false, error: "3-20 letters, numbers, or underscores only" };
  }
  return { ok: true, value };
}
