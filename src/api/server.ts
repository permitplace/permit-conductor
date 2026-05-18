/**
 * createServer — Express app factory for permit-conductor.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { PermitConductor } from '../agent/PermitConductor';
import { ConductorEvent } from '../types';
import { createRouter } from './router';
import { WebhookDelivery } from './webhooks';

export interface ServerOptions {
  /** If provided, conductor events are POSTed to this URL. */
  webhookUrl?:    string;
  /** HMAC secret for webhook signing.  Required when webhookUrl is set. */
  webhookSecret?: string;
}

export function createServer(
  conductor: PermitConductor,
  options: ServerOptions = {},
): Express {
  const app = express();

  // -------------------------------------------------------------------------
  // Body parsing
  // -------------------------------------------------------------------------
  app.use(express.json());

  // -------------------------------------------------------------------------
  // Mount router
  // -------------------------------------------------------------------------
  app.use('/v1', createRouter(conductor));

  // -------------------------------------------------------------------------
  // Webhook subscription
  // -------------------------------------------------------------------------
  if (options.webhookUrl) {
    const webhookUrl    = options.webhookUrl;
    const webhookSecret = options.webhookSecret ?? '';
    const delivery      = new WebhookDelivery(webhookSecret);

    const conductorEvents: Array<ConductorEvent['type']> = [
      'stage:transition',
      'documents:required',
      'review:failed',
      'monitor:update',
      'correction:guidance',
      'correction:user_action_required',
      'correction:validation_failed',
      'correction:escalation_required',
      'permit:approved',
      'permit:expiry_warning',
    ];

    for (const eventType of conductorEvents) {
      conductor.on(eventType as 'stage:transition', (payload) => {
        const event = { type: eventType, payload } as ConductorEvent;
        delivery.deliver(webhookUrl, event).catch(() => {
          // Delivery failure is logged inside WebhookDelivery; swallow here
          // to prevent unhandled rejection from crashing the server.
        });
      });
    }
  }

  // -------------------------------------------------------------------------
  // Global error handler
  // -------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
  });

  return app;
}
