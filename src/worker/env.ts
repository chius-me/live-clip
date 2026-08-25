import { DEFAULT_LIMITS, parsePositiveInt } from "../shared/limits";

export type RoomLimits = {
  retentionDays: number;
  maxDocumentBytes: number;
  maxMessageBytes: number;
  maxConnections: number;
  compactUpdateCount: number;
  compactUpdateBytes: number;
  rateLimitMessages: number;
  rateLimitWindowMs: number;
};

export function readLimits(env: Env): RoomLimits {
  return {
    retentionDays: parsePositiveInt(env.RETENTION_DAYS, DEFAULT_LIMITS.RETENTION_DAYS),
    maxDocumentBytes: parsePositiveInt(env.MAX_DOCUMENT_BYTES, DEFAULT_LIMITS.MAX_DOCUMENT_BYTES),
    maxMessageBytes: parsePositiveInt(env.MAX_MESSAGE_BYTES, DEFAULT_LIMITS.MAX_MESSAGE_BYTES),
    maxConnections: parsePositiveInt(env.MAX_CONNECTIONS, DEFAULT_LIMITS.MAX_CONNECTIONS),
    compactUpdateCount: parsePositiveInt(
      env.COMPACT_UPDATE_COUNT,
      DEFAULT_LIMITS.COMPACT_UPDATE_COUNT,
    ),
    compactUpdateBytes: parsePositiveInt(
      env.COMPACT_UPDATE_BYTES,
      DEFAULT_LIMITS.COMPACT_UPDATE_BYTES,
    ),
    rateLimitMessages: parsePositiveInt(
      env.RATE_LIMIT_MESSAGES,
      DEFAULT_LIMITS.RATE_LIMIT_MESSAGES,
    ),
    rateLimitWindowMs: parsePositiveInt(
      env.RATE_LIMIT_WINDOW_MS,
      DEFAULT_LIMITS.RATE_LIMIT_WINDOW_MS,
    ),
  };
}

export function isProduction(env: Env): boolean {
  return String(env.ENVIRONMENT) === "production";
}
