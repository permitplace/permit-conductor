import { SQLiteStateStore } from '../../src/state/SQLiteStateStore';
import { PermitProject, PermitStage, SubmissionStatusCode } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<PermitProject> = {}): PermitProject {
  const now = new Date().toISOString();
  return {
    id:           'proj-sqlite-1',
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
// Tests — use ':memory:' so each store is isolated and fast
// ---------------------------------------------------------------------------

describe('SQLiteStateStore', () => {
  let store: SQLiteStateStore;

  beforeEach(() => {
    store = new SQLiteStateStore({ path: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  describe('constructor', () => {
    it('defaults to :memory: when no path is given', () => {
      const s = new SQLiteStateStore();
      expect(s).toBeInstanceOf(SQLiteStateStore);
      s.close();
    });

    it('creates the schema on construction without throwing', () => {
      expect(() => new SQLiteStateStore({ path: ':memory:' })).not.toThrow();
    });
  });

  describe('save() and load()', () => {
    it('saves and loads a project by id', async () => {
      const project = makeProject();
      await store.save(project);

      const loaded = await store.load(project.id);
      expect(loaded.id).toBe(project.id);
      expect(loaded.jurisdiction).toBe('Austin, TX');
      expect(loaded.stage).toBe(PermitStage.DISCOVER);
    });

    it('preserves all PermitProject fields through JSON round-trip', async () => {
      const project = makeProject({
        submissions: [
          {
            id:          'sub-1',
            submittedAt: new Date().toISOString(),
            status:      SubmissionStatusCode.IN_REVIEW,
            referenceId: 'REF-001',
          },
        ],
        corrections: [],
        permitTypes: ['building', 'electrical'],
      });

      await store.save(project);
      const loaded = await store.load(project.id);

      expect(loaded.submissions).toHaveLength(1);
      expect(loaded.submissions[0].referenceId).toBe('REF-001');
      expect(loaded.permitTypes).toEqual(['building', 'electrical']);
    });

    it('throws when loading a non-existent project', async () => {
      await expect(store.load('nonexistent')).rejects.toThrow('Project not found: nonexistent');
    });
  });

  describe('save() idempotency (upsert)', () => {
    it('overwrites an existing project on second save', async () => {
      const project = makeProject();
      await store.save(project);

      const updated = { ...project, stage: PermitStage.PREPARE, updatedAt: new Date().toISOString() };
      await store.save(updated);

      const loaded = await store.load(project.id);
      expect(loaded.stage).toBe(PermitStage.PREPARE);
    });

    it('does not duplicate rows on repeated saves', async () => {
      const project = makeProject();
      await store.save(project);
      await store.save(project);
      await store.save(project);

      const all = await store.list();
      expect(all).toHaveLength(1);
    });

    it('updates the stage column used for filtering', async () => {
      const project = makeProject({ stage: PermitStage.DISCOVER });
      await store.save(project);

      const advanced = { ...project, stage: PermitStage.REVIEW, updatedAt: new Date().toISOString() };
      await store.save(advanced);

      const discoverList = await store.list({ stage: PermitStage.DISCOVER });
      expect(discoverList).toHaveLength(0);

      const reviewList = await store.list({ stage: PermitStage.REVIEW });
      expect(reviewList).toHaveLength(1);
    });
  });

  describe('list()', () => {
    beforeEach(async () => {
      await store.save(makeProject({ id: 'p1', stage: PermitStage.DISCOVER, jurisdiction: 'Austin, TX' }));
      await store.save(makeProject({ id: 'p2', stage: PermitStage.PREPARE, jurisdiction: 'Austin, TX' }));
      await store.save(makeProject({ id: 'p3', stage: PermitStage.REVIEW,  jurisdiction: 'Dallas, TX' }));
    });

    it('returns all projects when no filter is provided', async () => {
      const all = await store.list();
      expect(all).toHaveLength(3);
    });

    it('filters by stage', async () => {
      const result = await store.list({ stage: PermitStage.DISCOVER });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p1');
    });

    it('filters by jurisdiction', async () => {
      const result = await store.list({ jurisdiction: 'Dallas, TX' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p3');
    });

    it('combines stage and jurisdiction filters', async () => {
      const result = await store.list({ stage: PermitStage.PREPARE, jurisdiction: 'Austin, TX' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p2');
    });

    it('returns empty array when no projects match the filter', async () => {
      const result = await store.list({ stage: PermitStage.COMPLETE });
      expect(result).toHaveLength(0);
    });

    it('returns empty array when store is empty', async () => {
      const emptyStore = new SQLiteStateStore({ path: ':memory:' });
      const result = await emptyStore.list();
      expect(result).toHaveLength(0);
      emptyStore.close();
    });
  });

  describe('delete()', () => {
    it('deletes an existing project', async () => {
      const project = makeProject();
      await store.save(project);

      await store.delete(project.id);

      const all = await store.list();
      expect(all).toHaveLength(0);
    });

    it('throws when deleting a non-existent project', async () => {
      await expect(store.delete('ghost')).rejects.toThrow('Project not found: ghost');
    });

    it('does not affect other projects', async () => {
      await store.save(makeProject({ id: 'keep-1' }));
      await store.save(makeProject({ id: 'delete-me' }));

      await store.delete('delete-me');

      const all = await store.list();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('keep-1');
    });
  });

  describe('full CRUD cycle', () => {
    it('creates, updates, lists, and deletes a project', async () => {
      const project = makeProject({ id: 'lifecycle-1', stage: PermitStage.DISCOVER });

      // Create
      await store.save(project);
      expect(await store.list()).toHaveLength(1);

      // Update
      const updated = { ...project, stage: PermitStage.SUBMIT, updatedAt: new Date().toISOString() };
      await store.save(updated);
      const loaded = await store.load('lifecycle-1');
      expect(loaded.stage).toBe(PermitStage.SUBMIT);

      // List filtered
      const submitList = await store.list({ stage: PermitStage.SUBMIT });
      expect(submitList).toHaveLength(1);

      // Delete
      await store.delete('lifecycle-1');
      await expect(store.load('lifecycle-1')).rejects.toThrow('Project not found: lifecycle-1');
    });
  });
});
