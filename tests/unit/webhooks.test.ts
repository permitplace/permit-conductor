/**
 * Unit tests for WebhookDelivery.
 */

import { createHmac } from 'crypto';
import { WebhookDelivery } from '../../src/api/webhooks';
import { ConductorEvent, PermitStage } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = 'test-secret-abc123';

function makeEvent(): ConductorEvent {
  return {
    type:    'stage:transition',
    payload: {
      from:    PermitStage.DISCOVER,
      to:      PermitStage.PREPARE,
      project: {
        id:           'proj-1',
        stage:        PermitStage.PREPARE,
        jurisdiction: 'city-of-test',
        permitTypes:  ['building'],
        applicant:    { id: 'app-1', name: 'Alice', email: 'alice@example.com' },
        documents:    [],
        submissions:  [],
        corrections:  [],
        history:      [],
        createdAt:    '2026-05-17T00:00:00.000Z',
        updatedAt:    '2026-05-17T00:00:00.000Z',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebhookDelivery', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    // Mock global fetch
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // sign()
  // -------------------------------------------------------------------------
  describe('sign()', () => {
    it('produces a valid HMAC-SHA256 hex string', () => {
      const delivery  = new WebhookDelivery(SECRET);
      const payload   = '{"hello":"world"}';
      const signature = delivery.sign(payload);

      const expected = createHmac('sha256', SECRET).update(payload).digest('hex');
      expect(signature).toBe(expected);
    });

    it('produces different signatures for different payloads', () => {
      const delivery = new WebhookDelivery(SECRET);
      expect(delivery.sign('abc')).not.toBe(delivery.sign('xyz'));
    });

    it('produces different signatures for different secrets', () => {
      const d1 = new WebhookDelivery('secret-a');
      const d2 = new WebhookDelivery('secret-b');
      expect(d1.sign('same-payload')).not.toBe(d2.sign('same-payload'));
    });
  });

  // -------------------------------------------------------------------------
  // deliver()
  // -------------------------------------------------------------------------
  describe('deliver()', () => {
    it('POSTs to the url with JSON body', async () => {
      const delivery = new WebhookDelivery(SECRET);
      const event    = makeEvent();

      await delivery.deliver('https://hooks.example.com/permit', event);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://hooks.example.com/permit');
      expect(init.method).toBe('POST');
      expect(init.headers).toBeDefined();
    });

    it('sets X-Conductor-Signature header with correct HMAC', async () => {
      const delivery = new WebhookDelivery(SECRET);
      const event    = makeEvent();

      await delivery.deliver('https://hooks.example.com/permit', event);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers  = init.headers as Record<string, string>;
      const body     = init.body as string;

      const expected = createHmac('sha256', SECRET).update(body).digest('hex');
      expect(headers['X-Conductor-Signature']).toBe(expected);
    });

    it('sends Content-Type: application/json', async () => {
      const delivery = new WebhookDelivery(SECRET);
      await delivery.deliver('https://hooks.example.com/permit', makeEvent());

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers  = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('body includes event type and payload', async () => {
      const delivery = new WebhookDelivery(SECRET);
      const event    = makeEvent();

      await delivery.deliver('https://hooks.example.com/permit', event);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsed   = JSON.parse(init.body as string) as { event: string; payload: unknown };
      expect(parsed.event).toBe('stage:transition');
      expect(parsed.payload).toBeDefined();
    });

    it('marks delivered = true on 200 response', async () => {
      const delivery = new WebhookDelivery(SECRET);
      const record   = await delivery.deliver('https://hooks.example.com/permit', makeEvent());

      expect(record.delivered).toBe(true);
      expect(record.attempts[0].success).toBe(true);
    });

    it('records delivery in log', async () => {
      const delivery = new WebhookDelivery(SECRET);
      await delivery.deliver('https://hooks.example.com/permit', makeEvent());

      const log = delivery.getLog();
      expect(log).toHaveLength(1);
      expect(log[0].url).toBe('https://hooks.example.com/permit');
      expect(log[0].eventType).toBe('stage:transition');
    });
  });

  // -------------------------------------------------------------------------
  // Retry behaviour
  // -------------------------------------------------------------------------
  describe('retry behaviour', () => {
    it('retries on non-2xx response up to 3 times', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

      const delivery = new WebhookDelivery(SECRET);
      const record   = await delivery.deliver('https://hooks.example.com/permit', makeEvent());

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(record.delivered).toBe(false);
      expect(record.attempts).toHaveLength(3);
    }, 15_000); // allow time for backoff delays

    it('succeeds on second attempt and stops retrying', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const delivery = new WebhookDelivery(SECRET);
      const record   = await delivery.deliver('https://hooks.example.com/permit', makeEvent());

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(record.delivered).toBe(true);
      expect(record.attempts[0].success).toBe(false);
      expect(record.attempts[1].success).toBe(true);
    }, 10_000);

    it('records fetch errors in attempt log', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const delivery = new WebhookDelivery(SECRET);
      const record   = await delivery.deliver('https://hooks.example.com/permit', makeEvent());

      expect(record.delivered).toBe(false);
      for (const attempt of record.attempts) {
        expect(attempt.error).toBe('ECONNREFUSED');
      }
    }, 15_000);
  });

  // -------------------------------------------------------------------------
  // Signature validation helper
  // -------------------------------------------------------------------------
  describe('signature validation', () => {
    it('caller can re-derive and verify signature from known secret', async () => {
      const delivery = new WebhookDelivery(SECRET);
      const event    = makeEvent();

      await delivery.deliver('https://hooks.example.com/permit', event);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const rawBody  = init.body as string;
      const received = (init.headers as Record<string, string>)['X-Conductor-Signature'];
      const recomputed = createHmac('sha256', SECRET).update(rawBody).digest('hex');

      expect(received).toBe(recomputed);
    });
  });
});
