/**
 * Integration tests for the REST API layer (Phase 4).
 * Uses supertest against a real Express app backed by mock skills.
 */

import request from 'supertest';
import { PermitConductor } from '../../src/agent/PermitConductor';
import { InMemoryStateStore } from '../../src/state/InMemoryStateStore';
import { MockBrainSkill } from '../../src/skills/mocks/MockBrainSkill';
import { MockSubmissionSkill } from '../../src/skills/mocks/MockSubmissionSkill';
import { createServer } from '../../src/api/server';
import {
  ConductorConfig,
  SubmissionStatusCode,
  VerificationStatus,
} from '../../src/types';
import type { Express } from 'express';

// ---------------------------------------------------------------------------
// Minimal mock skill stubs
// ---------------------------------------------------------------------------

class MockVerificationSkill {
  async getStatus(_id: string): Promise<VerificationStatus> {
    return {
      code:      SubmissionStatusCode.IN_REVIEW,
      message:   'Under review',
      updatedAt: new Date().toISOString(),
    };
  }
}

class MockPlansReviewSkill {
  async checkCompliance(): Promise<{ passed: boolean; failures: [] }> {
    return { passed: true, failures: [] };
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeConfig(): ConductorConfig {
  return {
    skills: {
      brain:       new MockBrainSkill() as unknown as ConductorConfig['skills']['brain'],
      submission:  new MockSubmissionSkill() as unknown as ConductorConfig['skills']['submission'],
      verification: new MockVerificationSkill() as unknown as ConductorConfig['skills']['verification'],
      plansReview:  new MockPlansReviewSkill() as unknown as ConductorConfig['skills']['plansReview'],
    },
    stateStore: new InMemoryStateStore(),
  };
}

const VALID_START_BODY = {
  jurisdiction: 'city-of-test',
  permitTypes:  ['building'],
  applicant: {
    id:    'app-001',
    name:  'Jane Doe',
    email: 'jane@example.com',
  },
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('REST API — Phase 4', () => {
  let app: Express;
  let conductor: PermitConductor;

  beforeEach(() => {
    conductor = new PermitConductor(makeConfig());
    app       = createServer(conductor);
  });

  // -------------------------------------------------------------------------
  // GET /v1/health
  // -------------------------------------------------------------------------
  describe('GET /v1/health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/v1/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok' });
      expect(typeof res.body.version).toBe('string');
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/projects
  // -------------------------------------------------------------------------
  describe('POST /v1/projects', () => {
    it('returns 201 with a project on valid body', async () => {
      const res = await request(app)
        .post('/v1/projects')
        .send(VALID_START_BODY);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('stage');
      expect(res.body).toHaveProperty('jurisdiction', 'city-of-test');
    });

    it('returns 400 when jurisdiction is missing', async () => {
      const res = await request(app)
        .post('/v1/projects')
        .send({ permitTypes: ['building'], applicant: VALID_START_BODY.applicant });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('returns 400 when permitTypes is empty array', async () => {
      const res = await request(app)
        .post('/v1/projects')
        .send({ ...VALID_START_BODY, permitTypes: [] });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('returns 400 when applicant email is invalid', async () => {
      const res = await request(app)
        .post('/v1/projects')
        .send({
          ...VALID_START_BODY,
          applicant: { ...VALID_START_BODY.applicant, email: 'not-an-email' },
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('returns 400 when body is not JSON', async () => {
      const res = await request(app)
        .post('/v1/projects')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // GET /v1/projects/:id
  // -------------------------------------------------------------------------
  describe('GET /v1/projects/:id', () => {
    it('returns 200 with project state after creation', async () => {
      const createRes = await request(app)
        .post('/v1/projects')
        .send(VALID_START_BODY);

      const projectId = createRes.body.id as string;

      const getRes = await request(app).get(`/v1/projects/${projectId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(projectId);
    });

    it('returns 404 for an unknown project id', async () => {
      const res = await request(app).get('/v1/projects/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/projects/:id/advance
  // -------------------------------------------------------------------------
  describe('POST /v1/projects/:id/advance', () => {
    it('returns 200 with stage and status', async () => {
      const createRes = await request(app)
        .post('/v1/projects')
        .send(VALID_START_BODY);

      const projectId = createRes.body.id as string;

      const advRes = await request(app).post(`/v1/projects/${projectId}/advance`);
      expect(advRes.status).toBe(200);
      expect(advRes.body).toHaveProperty('stage');
      expect(advRes.body).toHaveProperty('status');
    });

    it('returns 404 for unknown project id', async () => {
      const res = await request(app).post('/v1/projects/ghost-id/advance');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/projects/:id/documents
  // -------------------------------------------------------------------------
  describe('POST /v1/projects/:id/documents', () => {
    it('returns 200 after uploading documents', async () => {
      const createRes = await request(app)
        .post('/v1/projects')
        .send(VALID_START_BODY);

      const projectId = createRes.body.id as string;

      const docRes = await request(app)
        .post(`/v1/projects/${projectId}/documents`)
        .send({
          documents: [
            {
              name:     'site_plan.pdf',
              type:     'site_plan',
              url:      'https://example.com/docs/site_plan.pdf',
              mimeType: 'application/pdf',
            },
          ],
        });

      expect(docRes.status).toBe(200);
      expect(docRes.body).toHaveProperty('ok', true);
    });

    it('returns 400 when documents array is missing', async () => {
      const createRes = await request(app)
        .post('/v1/projects')
        .send(VALID_START_BODY);

      const projectId = createRes.body.id as string;

      const res = await request(app)
        .post(`/v1/projects/${projectId}/documents`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('returns 400 when document url is invalid', async () => {
      const createRes = await request(app)
        .post('/v1/projects')
        .send(VALID_START_BODY);

      const projectId = createRes.body.id as string;

      const res = await request(app)
        .post(`/v1/projects/${projectId}/documents`)
        .send({
          documents: [
            {
              name:     'site_plan.pdf',
              type:     'site_plan',
              url:      'not-a-url',
              mimeType: 'application/pdf',
            },
          ],
        });

      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown project', async () => {
      const res = await request(app)
        .post('/v1/projects/nope/documents')
        .send({
          documents: [
            {
              name:     'f.pdf',
              type:     'site_plan',
              url:      'https://example.com/f.pdf',
              mimeType: 'application/pdf',
            },
          ],
        });

      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /v1/projects/:id
  // -------------------------------------------------------------------------
  describe('DELETE /v1/projects/:id', () => {
    it('returns 204 on successful cancel', async () => {
      const createRes = await request(app)
        .post('/v1/projects')
        .send(VALID_START_BODY);

      const projectId = createRes.body.id as string;

      const delRes = await request(app).delete(`/v1/projects/${projectId}`);
      expect(delRes.status).toBe(204);
    });

    it('returns 404 for unknown project', async () => {
      const res = await request(app).delete('/v1/projects/ghost');
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // GET /v1/projects/:id/events  — SSE
  // -------------------------------------------------------------------------
  describe('GET /v1/projects/:id/events', () => {
    it('returns text/event-stream content type and initial connected event', (done) => {
      request(app)
        .post('/v1/projects')
        .send(VALID_START_BODY)
        .end((_err, createRes) => {
          const projectId = createRes.body.id as string;

          // Use http.get so we can read the streaming response incrementally
          const http = require('http') as typeof import('http');
          const server = app.listen(0, () => {
            const addr = server.address() as import('net').AddressInfo;
            const req  = http.get(
              `http://127.0.0.1:${addr.port}/v1/projects/${projectId}/events`,
              (res) => {
                expect(res.headers['content-type']).toMatch(/text\/event-stream/);

                let buffer = '';
                res.on('data', (chunk: Buffer) => {
                  buffer += chunk.toString();
                  if (buffer.includes('connected')) {
                    req.destroy();
                    server.close(done);
                  }
                });
              },
            );

            req.on('error', (e: Error) => {
              // Ignore ECONNRESET from req.destroy()
              if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') {
                server.close(() => done(e));
              } else {
                server.close(done);
              }
            });
          });
        });
    });
  });
});
