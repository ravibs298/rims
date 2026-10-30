/** Exponential backoff: base * 2^(attempt-1), capped. attempt is 1-based (the attempt that just failed). */
export function computeBackoff(attempt: number, baseMs: number, maxMs: number, jitter = 0): number {
  const raw = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (1 - jitter * Math.random()));
}

export class DeliveryError extends Error {
  constructor(message: string, public retryable: boolean, public status?: number) {
    super(message);
  }
}

/** HTTP statuses worth retrying; other 4xx mean the message itself is wrong. */
export const isRetryableStatus = (s: number) => s >= 500 || s === 408 || s === 425 || s === 429;
