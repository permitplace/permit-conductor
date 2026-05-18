/**
 * permit-conductor REST router
 * Mounts under /v1 in server.ts
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PermitConductor } from '../agent/PermitConductor';
import { ConductorEvent, PermitStage } from '../types';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ApplicantSchema = z.object({
  id:      z.string().min(1),
  name:    z.string().min(1),
  email:   z.string().email(),
  phone:   z.string().optional(),
  address: z.string().optional(),
});

const StartProjectSchema = z.object({
  jurisdiction: z.string().min(1),
  permitTypes:  z.array(z.string().min(1)).min(1),
  applicant:    ApplicantSchema,
});

const DocumentSchema = z.object({
  id:         z.string().optional(),
  name:       z.string().min(1),
  type:       z.string().min(1),
  url:        z.string().url(),
  mimeType:   z.string().min(1),
  uploadedAt: z.string().optional(),
});

const UploadDocumentsSchema = z.object({
  documents: z.array(DocumentSchema).min(1),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
  res: Response,
): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({
      error: result.error.issues.map((i) => i.message).join('; '),
      code:  'VALIDATION_ERROR',
    });
    return null;
  }
  return result.data;
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes('not found') || err.message.includes('Not found'))
  );
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

interface SseClient {
  projectId: string;
  res:       Response;
}

const sseClients: SseClient[] = [];

function broadcastSse(projectId: string, event: ConductorEvent): void {
  const data = JSON.stringify(event);
  for (const client of sseClients) {
    if (client.projectId === projectId) {
      client.res.write(`data: ${data}\n\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRouter(conductor: PermitConductor): Router {
  const router = Router();

  // Wire all conductor events → SSE broadcast
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
      // Determine projectId from the payload
      let projectId: string | undefined;
      if (payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>;
        if (typeof p['projectId'] === 'string') {
          projectId = p['projectId'];
        } else if (p['project'] && typeof (p['project'] as Record<string, unknown>)['id'] === 'string') {
          projectId = (p['project'] as Record<string, unknown>)['id'] as string;
        }
      }
      if (projectId) {
        broadcastSse(projectId, { type: eventType, payload } as ConductorEvent);
      }
    });
  }

  // -------------------------------------------------------------------------
  // GET /health
  // -------------------------------------------------------------------------
  router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', version: '0.1.0' });
  });

  // -------------------------------------------------------------------------
  // POST /projects
  // -------------------------------------------------------------------------
  router.post('/projects', async (req: Request, res: Response, next: NextFunction) => {
    const body = parseBody(StartProjectSchema, req.body, res);
    if (!body) return;

    try {
      const project = await conductor.start(body);
      res.status(201).json(project);
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // GET /projects/:id
  // -------------------------------------------------------------------------
  router.get('/projects/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const project = await conductor.getProject(req.params['id'] as string);
      res.status(200).json(project);
    } catch (err) {
      if (isNotFound(err)) {
        res.status(404).json({ error: (err as Error).message, code: 'NOT_FOUND' });
      } else {
        next(err);
      }
    }
  });

  // -------------------------------------------------------------------------
  // POST /projects/:id/advance
  // -------------------------------------------------------------------------
  router.post('/projects/:id/advance', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await conductor.advance(req.params['id'] as string);
      res.status(200).json({ stage: result.project.stage, status: result.status });
    } catch (err) {
      if (isNotFound(err)) {
        res.status(404).json({ error: (err as Error).message, code: 'NOT_FOUND' });
      } else {
        next(err);
      }
    }
  });

  // -------------------------------------------------------------------------
  // POST /projects/:id/documents
  // -------------------------------------------------------------------------
  router.post('/projects/:id/documents', async (req: Request, res: Response, next: NextFunction) => {
    const body = parseBody(UploadDocumentsSchema, req.body, res);
    if (!body) return;

    try {
      await conductor.uploadDocuments(req.params['id'] as string, body.documents as Parameters<typeof conductor.uploadDocuments>[1]);
      res.status(200).json({ ok: true });
    } catch (err) {
      if (isNotFound(err)) {
        res.status(404).json({ error: (err as Error).message, code: 'NOT_FOUND' });
      } else {
        next(err);
      }
    }
  });

  // -------------------------------------------------------------------------
  // POST /projects/:id/corrections/:correctionId/resolve
  // -------------------------------------------------------------------------
  router.post(
    '/projects/:id/corrections/:correctionId/resolve',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await conductor.resolveCorrection(
          req.params['id'] as string,
          req.params['correctionId'] as string,
        );
        res.status(200).json({ ok: true });
      } catch (err) {
        if (isNotFound(err)) {
          res.status(404).json({ error: (err as Error).message, code: 'NOT_FOUND' });
        } else {
          next(err);
        }
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /projects/:id/events  — SSE stream
  // -------------------------------------------------------------------------
  router.get('/projects/:id/events', (req: Request, res: Response) => {
    const projectId = req.params['id'] as string;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const client: SseClient = { projectId, res };
    sseClients.push(client);

    // Send a connected ping
    res.write(`data: ${JSON.stringify({ type: 'connected', projectId })}\n\n`);

    req.on('close', () => {
      const idx = sseClients.indexOf(client);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /projects/:id
  // -------------------------------------------------------------------------
  router.delete('/projects/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const project = await conductor.getProject(req.params['id'] as string);
      // Mark cancelled via state store directly (conductor doesn't expose cancel)
      // We load, set stage, then save via advance — but conductor has no cancel method.
      // Use the stateStore delete path: reload then mark CANCELLED + delete.
      // Since PermitConductor exposes getProject but not cancel/delete directly,
      // we access through the conductor's internal state store via getProject + a workaround.
      // ProjectManager.cancel exists but is not exposed on PermitConductor — we call delete on
      // the stateStore through the conductor's config (not accessible externally).
      // Best path: use the stateStore attached to the conductor via casting.
      // The conductor config is private — we need to expose delete or cancel.
      // For now we mark stage CANCELLED and rely on stateStore.delete being called via
      // a type-safe cast through getProject's backing store.
      // The stateStore.delete is the right semantic — re-throw NotFound as 404.
      // Access pattern: use conductor internals via a known interface cast.
      const stateStore = (conductor as unknown as { config: { stateStore: { delete(id: string): Promise<void>; save(p: typeof project): Promise<void> } } }).config.stateStore;
      project.stage = PermitStage.CANCELLED;
      project.updatedAt = new Date().toISOString();
      await stateStore.save(project);
      res.status(204).send();
    } catch (err) {
      if (isNotFound(err)) {
        res.status(404).json({ error: (err as Error).message, code: 'NOT_FOUND' });
      } else {
        next(err);
      }
    }
  });

  return router;
}
