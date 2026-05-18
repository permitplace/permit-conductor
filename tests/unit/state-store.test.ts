import { InMemoryStateStore } from '../../src/state/InMemoryStateStore';
import { PermitProject, PermitStage } from '../../src/types';

function makeProject(overrides: Partial<PermitProject> = {}): PermitProject {
  const now = new Date().toISOString();
  return {
    id:           'proj-test-1',
    stage:        PermitStage.DISCOVER,
    jurisdiction: 'Austin, TX',
    permitTypes:  ['building'],
    applicant: {
      id:    'app-1',
      name:  'Jane Doe',
      email: 'jane@example.com',
    },
    documents:    [],
    submissions:  [],
    corrections:  [],
    history:      [],
    createdAt:    now,
    updatedAt:    now,
    ...overrides,
  };
}

describe('InMemoryStateStore', () => {
  let store: InMemoryStateStore;

  beforeEach(() => {
    store = new InMemoryStateStore();
  });

  describe('save and load', () => {
    it('saves and loads a project by id', async () => {
      const project = makeProject();
      await store.save(project);

      const loaded = await store.load(project.id);
      expect(loaded.id).toBe(project.id);
      expect(loaded.jurisdiction).toBe('Austin, TX');
    });

    it('returns a deep copy on load (mutation safety)', async () => {
      const project = makeProject();
      await store.save(project);

      const loaded = await store.load(project.id);
      loaded.jurisdiction = 'MUTATED';

      const reloaded = await store.load(project.id);
      expect(reloaded.jurisdiction).toBe('Austin, TX');
    });

    it('throws when loading a non-existent project', async () => {
      await expect(store.load('nonexistent')).rejects.toThrow('Project not found: nonexistent');
    });

    it('overwrites an existing project on save', async () => {
      const project = makeProject();
      await store.save(project);

      const updated = { ...project, stage: PermitStage.PREPARE };
      await store.save(updated);

      const loaded = await store.load(project.id);
      expect(loaded.stage).toBe(PermitStage.PREPARE);
    });
  });

  describe('list', () => {
    it('lists all projects when no filter', async () => {
      await store.save(makeProject({ id: 'p1' }));
      await store.save(makeProject({ id: 'p2', jurisdiction: 'Dallas, TX' }));

      const all = await store.list();
      expect(all).toHaveLength(2);
    });

    it('filters by stage', async () => {
      await store.save(makeProject({ id: 'p1', stage: PermitStage.DISCOVER }));
      await store.save(makeProject({ id: 'p2', stage: PermitStage.PREPARE }));

      const discovered = await store.list({ stage: PermitStage.DISCOVER });
      expect(discovered).toHaveLength(1);
      expect(discovered[0].id).toBe('p1');
    });

    it('filters by jurisdiction', async () => {
      await store.save(makeProject({ id: 'p1', jurisdiction: 'Austin, TX' }));
      await store.save(makeProject({ id: 'p2', jurisdiction: 'Dallas, TX' }));

      const austin = await store.list({ jurisdiction: 'Austin, TX' });
      expect(austin).toHaveLength(1);
      expect(austin[0].id).toBe('p1');
    });

    it('returns empty array when store is empty', async () => {
      const all = await store.list();
      expect(all).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('deletes an existing project', async () => {
      const project = makeProject();
      await store.save(project);
      expect(store.size).toBe(1);

      await store.delete(project.id);
      expect(store.size).toBe(0);
    });

    it('throws when deleting a non-existent project', async () => {
      await expect(store.delete('ghost')).rejects.toThrow('Project not found: ghost');
    });
  });
});
