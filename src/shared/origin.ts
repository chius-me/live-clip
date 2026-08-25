export function isAllowedOrigin(
  origin: string | null,
  requestUrl: string,
  extraAllowed: string | undefined,
): boolean {
  if (!origin) {
    return false;
  }
  try {
    if (origin === new URL(requestUrl).origin) {
      return true;
    }
  } catch {
    return false;
  }
  if (!extraAllowed) {
    return false;
  }
  return extraAllowed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(origin);
}
