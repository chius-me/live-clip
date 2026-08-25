export const DEFAULT_LIMITS = {
  RETENTION_DAYS: 30,
  MAX_DOCUMENT_BYTES: 1_048_576,
  MAX_MESSAGE_BYTES: 65_536,
  MAX_CONNECTIONS: 50,
  COMPACT_UPDATE_COUNT: 100,
  COMPACT_UPDATE_BYTES: 131_072,
  RATE_LIMIT_MESSAGES: 40,
  RATE_LIMIT_WINDOW_MS: 1_000,
} as const;

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}
