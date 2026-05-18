/**
 * WebhookDelivery — outbound webhook delivery with HMAC-SHA256 signing and retry.
 */

import { createHmac } from 'crypto';
import { ConductorEvent } from '../types';

export interface DeliveryAttempt {
  attemptNumber: number;
  timestamp:     string;
  statusCode?:   number;
  success:       boolean;
  error?:        string;
}

export interface DeliveryRecord {
  url:       string;
  eventType: string;
  attempts:  DeliveryAttempt[];
  delivered: boolean;
}

const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(
  url: string,
  body: string,
  signature: string,
): Promise<{ statusCode: number }> {
  // Use built-in fetch (Node 18+) — fall back to http/https for older envs.
  const resp = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':           'application/json',
      'X-Conductor-Signature':  signature,
    },
    body,
  });
  return { statusCode: resp.status };
}

export class WebhookDelivery {
  private readonly secret: string;
  private readonly log:    DeliveryRecord[] = [];

  constructor(secret: string) {
    this.secret = secret;
  }

  /**
   * Build the HMAC-SHA256 hex signature for `payload`.
   */
  sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('hex');
  }

  /**
   * Deliver `event` to `url`.  Retries up to 3 times (1s / 2s / 4s backoff).
   * Resolves with the delivery record regardless of final outcome.
   */
  async deliver(url: string, event: ConductorEvent): Promise<DeliveryRecord> {
    const body      = JSON.stringify({ event: event.type, payload: event.payload });
    const signature = this.sign(body);

    const record: DeliveryRecord = {
      url,
      eventType: event.type,
      attempts:  [],
      delivered: false,
    };

    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
      const attemptEntry: DeliveryAttempt = {
        attemptNumber: attempt + 1,
        timestamp:     new Date().toISOString(),
        success:       false,
      };

      try {
        const { statusCode } = await postJson(url, body, signature);
        attemptEntry.statusCode = statusCode;
        attemptEntry.success    = statusCode >= 200 && statusCode < 300;
      } catch (err) {
        attemptEntry.error = err instanceof Error ? err.message : String(err);
      }

      record.attempts.push(attemptEntry);

      if (attemptEntry.success) {
        record.delivered = true;
        break;
      }

      // Wait before next attempt (skip delay after last attempt)
      if (attempt < RETRY_DELAYS_MS.length - 1) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }

    this.log.push(record);
    return record;
  }

  /** Return a copy of all delivery records (for testing / auditing). */
  getLog(): DeliveryRecord[] {
    return [...this.log];
  }
}
