import { Pool, QueryResult } from 'pg';
import { PostgresStateStore } from '../../src/state/PostgresStateStore';
import { PermitProject, PermitStage, SubmissionStatusCode } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<PermitProject> = {}): PermitProject {
  const now = new Date().toISOString();
  return {
    id:           'proj-pg-1',
    stage:        PermitStage.DISCOVER,
    jurisdiction: 'Austin, TX',
    permitTypes:  ['building'],
    applicant: {
      id:    'app-1',
      name:  'Jane Doe',
      email: 'jane@example.com',
    },
    documents:   [],
    submissions: [],
    corrections: [],
    history:     [],
    createdAt:   now,
    updatedAt:   now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// pg Pool mock
//
// We cannot use mockResolvedValueOnce on top of a mockImplementation wrapper
// because calling mockResolvedValueOnce replaces the entire implementation for
// that one call, meaning our capture logic never runs.
//
// Instead we maintain a response queue ourselves inside the implementation and
// expose an `enqueue` helper.  The mock captures args and pops from the queue.
// ---------------------------------------------------------------------------

interface PoolMock {
  pool: Pool;
  /** Queue one query result to be returned by the next pool.query() call */
  enqueue(response: Partial<QueryResult>): void;
  /** Return the sql text and values from the most recent pool.query() call */
  lastQuery(): { text: string; values: unknown[] };
}

function makePoolMock(): PoolMock {
  let lastText   = '';
  let lastValues: unknown[] = [];
  const queue: Array<Partial<QueryResult>> = [];

  const queryMock = jest.fn().mockImplementation((...args: unknown[]) => {
    lastText   = args[0] as string;
    lastValues = (args[1] as unknown[]) ?? [];
    const next = queue.shift();
    return Promise.resolve(next ?? { rows: [], rowCount: 0 });
  });

  const pool = {
    query: queryMock,
    end:   jest.fn().mockResolvedValue(undefined),
  } as unknown as Pool;

  return {
    pool,
    enqueue:   (r) => queue.push(r),
    lastQuery: () => ({ text: lastText, values: lastValues }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PostgresStateStore', () => {
  describe('constructor', () => {
    it('accepts an external Pool', () => {
      const { pool } = makePoolMock();
      expect(() => new PostgresStateStore({ pool })).not.toThrow();
    });

    it('accepts a connectionString', () => {
      expect(
        () => new PostgresStateStore({ connectionString: 'postgresql://localhost/test' })
      ).not.toThrow();
    });

    it('throws when neither pool nor connectionString is provided', () => {
      expect(() => new PostgresStateStore({})).toThrow(
        'PostgresStateStore requires either a connectionString or a pool'
      );
    });
  });

  describe('init()', () => {
    it('executes a CREATE TABLE IF NOT EXISTS query', async () => {
      const { pool, lastQuery } = makePoolMock();
      const store = new PostgresStateStore({ pool });
      await store.init();

      const { text } = lastQuery();
      expect(text).toContain('CREATE TABLE IF NOT EXISTS permit_projects');
      expect(text).toContain('CREATE INDEX IF NOT EXISTS');
    });
  });

  describe('load()', () => {
    it('selects by id and returns the parsed project', async () => {
      const project = makeProject();
      const { pool, enqueue, lastQuery } = makePoolMock();
      enqueue({ rows: [{ data: project }], rowCount: 1 });

      const store = new PostgresStateStore({ pool });
      const loaded = await store.load(project.id);

      expect(loaded).toEqual(project);
      const { text, values } = lastQuery();
      expect(text).toContain('SELECT data FROM permit_projects');
      expect(text).toContain('WHERE id = $1');
      expect(values).toEqual([project.id]);
    });

    it('throws when project is not found', async () => {
      const { pool, enqueue } = makePoolMock();
      enqueue({ rows: [], rowCount: 0 });

      const store = new PostgresStateStore({ pool });
      await expect(store.load('nonexistent')).rejects.toThrow('Project not found: nonexistent');
    });
  });

  describe('save()', () => {
    it('executes an upsert query with correct parameters', async () => {
      const project = makeProject();
      const { pool, enqueue, lastQuery } = makePoolMock();
      enqueue({ rows: [], rowCount: 1 });

      const store = new PostgresStateStore({ pool });
      await store.save(project);

      const { text, values } = lastQuery();
      expect(text).toContain('INSERT INTO permit_projects');
      expect(text).toContain('ON CONFLICT (id) DO UPDATE');
      expect(values[0]).toBe(project.id);
      expect(values[1]).toBe(project.stage);
      expect(values[2]).toBe(project.jurisdiction);
      // data column: the store serializes the full project as JSON
      expect(JSON.parse(values[3] as string)).toEqual(project);
      expect(values[4]).toBe(project.createdAt);
      expect(values[5]).toBe(project.updatedAt);
    });

    it('serializes and deserializes PermitProject without data loss', async () => {
      const project = makeProject({
        stage: PermitStage.PREPARE,
        corrections: [],
        submissions: [
          {
            id:          'sub-1',
            submittedAt: new Date().toISOString(),
            status:      SubmissionStatusCode.SUBMITTED,
          },
        ],
      });
      const { pool, enqueue, lastQuery } = makePoolMock();
      enqueue({ rows: [], rowCount: 1 });

      const store = new PostgresStateStore({ pool });
      await store.save(project);

      const { values } = lastQuery();
      const roundTripped = JSON.parse(values[3] as string) as PermitProject;
      expect(roundTripped.stage).toBe(PermitStage.PREPARE);
      expect(roundTripped.submissions).toHaveLength(1);
      expect(roundTripped.submissions[0].id).toBe('sub-1');
    });

    it('is idempotent: calling save twice does not throw', async () => {
      const project = makeProject();
      const { pool, enqueue } = makePoolMock();
      enqueue({ rows: [], rowCount: 1 });
      enqueue({ rows: [], rowCount: 1 });

      const store = new PostgresStateStore({ pool });
      await expect(store.save(project)).resolves.toBeUndefined();
      await expect(store.save({ ...project, stage: PermitStage.PREPARE })).resolves.toBeUndefined();
    });
  });

  describe('list()', () => {
    it('returns all projects when no filter is provided', async () => {
      const projects = [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })];
      const { pool, enqueue, lastQuery } = makePoolMock();
      enqueue({ rows: projects.map((p) => ({ data: p })), rowCount: 2 });

      const store = new PostgresStateStore({ pool });
      const result = await store.list();

      expect(result).toHaveLength(2);
      const { text, values } = lastQuery();
      expect(text).not.toContain('WHERE');
      expect(values).toEqual([]);
    });

    it('adds a stage filter when provided', async () => {
      const { pool, lastQuery } = makePoolMock();
      // no enqueue needed — queue is empty → default { rows: [], rowCount: 0 }

      const store = new PostgresStateStore({ pool });
      await store.list({ stage: PermitStage.REVIEW });

      const { text, values } = lastQuery();
      expect(text).toContain('WHERE');
      expect(text).toContain('stage = $1');
      expect(values).toEqual([PermitStage.REVIEW]);
    });

    it('adds a jurisdiction filter when provided', async () => {
      const { pool, lastQuery } = makePoolMock();

      const store = new PostgresStateStore({ pool });
      await store.list({ jurisdiction: 'Austin, TX' });

      const { text, values } = lastQuery();
      expect(text).toContain('jurisdiction = $1');
      expect(values).toContain('Austin, TX');
    });

    it('combines stage and jurisdiction filters with AND', async () => {
      const { pool, lastQuery } = makePoolMock();

      const store = new PostgresStateStore({ pool });
      await store.list({ stage: PermitStage.SUBMIT, jurisdiction: 'Dallas, TX' });

      const { text, values } = lastQuery();
      expect(text).toContain('stage = $1');
      expect(text).toContain('jurisdiction = $2');
      expect(values).toEqual([PermitStage.SUBMIT, 'Dallas, TX']);
    });

    it('maps JSONB data rows to PermitProject objects', async () => {
      const project = makeProject({ id: 'list-1', stage: PermitStage.MONITOR });
      const { pool, enqueue } = makePoolMock();
      enqueue({ rows: [{ data: project }], rowCount: 1 });

      const store = new PostgresStateStore({ pool });
      const result = await store.list();
      expect(result[0]).toEqual(project);
    });
  });

  describe('delete()', () => {
    it('executes DELETE by id', async () => {
      const { pool, enqueue, lastQuery } = makePoolMock();
      enqueue({ rows: [], rowCount: 1 });

      const store = new PostgresStateStore({ pool });
      await store.delete('proj-pg-1');

      const { text, values } = lastQuery();
      expect(text).toContain('DELETE FROM permit_projects');
      expect(text).toContain('WHERE id = $1');
      expect(values).toEqual(['proj-pg-1']);
    });

    it('throws when project is not found (rowCount 0)', async () => {
      const { pool } = makePoolMock();
      // default queue response is rowCount: 0 → no enqueue needed

      const store = new PostgresStateStore({ pool });
      await expect(store.delete('ghost')).rejects.toThrow('Project not found: ghost');
    });
  });

  describe('close()', () => {
    it('does not call pool.end() when the store received an external pool', async () => {
      const { pool } = makePoolMock();
      const store = new PostgresStateStore({ pool });

      await expect(store.close()).resolves.toBeUndefined();
      expect((pool.end as jest.Mock)).not.toHaveBeenCalled();
    });
  });
});
