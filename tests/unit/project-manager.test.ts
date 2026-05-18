/**
 * Unit tests: ProjectManager
 *
 * Covers: create, get, addDocuments, cancel, list, save
 */

import { ProjectManager } from '../../src/agent/ProjectManager';
import { InMemoryStateStore } from '../../src/state/InMemoryStateStore';
import { PermitStage, Document } from '../../src/types';

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id:         'doc-1',
    name:       'Floor Plan',
    type:       'floor_plan',
    url:        'https://example.com/floor-plan.pdf',
    mimeType:   'application/pdf',
    uploadedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ProjectManager', () => {
  let store: InMemoryStateStore;
  let manager: ProjectManager;

  beforeEach(() => {
    store   = new InMemoryStateStore();
    manager = new ProjectManager(store);
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  describe('create()', () => {
    it('creates a project with DISCOVER stage', async () => {
      const project = await manager.create({
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Jane Doe', email: 'jane@example.com' },
      });

      expect(project.id).toBeTruthy();
      expect(project.stage).toBe(PermitStage.DISCOVER);
      expect(project.jurisdiction).toBe('Austin, TX');
      expect(project.permitTypes).toEqual(['building']);
      expect(project.documents).toEqual([]);
      expect(project.submissions).toEqual([]);
      expect(project.corrections).toEqual([]);
      expect(project.history).toEqual([]);
    });

    it('persists the project to the store', async () => {
      const project = await manager.create({
        jurisdiction: 'Dallas, TX',
        permitTypes:  ['electrical'],
        applicant: { id: 'app-2', name: 'Bob Builder', email: 'bob@example.com' },
      });

      const loaded = await store.load(project.id);
      expect(loaded.id).toBe(project.id);
      expect(loaded.jurisdiction).toBe('Dallas, TX');
    });

    it('generates a unique id for each project', async () => {
      const params = {
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Alice', email: 'alice@example.com' },
      };
      const p1 = await manager.create(params);
      const p2 = await manager.create(params);

      expect(p1.id).not.toBe(p2.id);
    });

    it('sets createdAt and updatedAt timestamps', async () => {
      const project = await manager.create({
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Jane', email: 'jane@example.com' },
      });

      expect(project.createdAt).toBeTruthy();
      expect(project.updatedAt).toBeTruthy();
      expect(new Date(project.createdAt).getTime()).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // get
  // ---------------------------------------------------------------------------

  describe('get()', () => {
    it('retrieves a project by id', async () => {
      const created = await manager.create({
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Jane', email: 'jane@example.com' },
      });

      const retrieved = await manager.get(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.stage).toBe(PermitStage.DISCOVER);
    });

    it('throws when project does not exist', async () => {
      await expect(manager.get('nonexistent-id')).rejects.toThrow('Project not found');
    });
  });

  // ---------------------------------------------------------------------------
  // addDocuments
  // ---------------------------------------------------------------------------

  describe('addDocuments()', () => {
    it('appends documents to an existing project', async () => {
      const project = await manager.create({
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Jane', email: 'jane@example.com' },
      });

      const updated = await manager.addDocuments(project.id, [
        makeDoc({ id: 'doc-1', type: 'floor_plan' }),
        makeDoc({ id: 'doc-2', type: 'site_plan' }),
      ]);

      expect(updated.documents).toHaveLength(2);
      expect(updated.documents[0].id).toBe('doc-1');
      expect(updated.documents[1].id).toBe('doc-2');
    });

    it('preserves existing documents when adding new ones', async () => {
      const project = await manager.create({
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Jane', email: 'jane@example.com' },
      });

      await manager.addDocuments(project.id, [makeDoc({ id: 'doc-1' })]);
      const updated = await manager.addDocuments(project.id, [makeDoc({ id: 'doc-2', name: 'Site Plan', type: 'site_plan' })]);

      expect(updated.documents).toHaveLength(2);
    });

    it('updates updatedAt timestamp', async () => {
      const project = await manager.create({
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Jane', email: 'jane@example.com' },
      });

      const before = project.updatedAt;
      // Ensure time advances
      await new Promise((r) => setTimeout(r, 5));
      const updated = await manager.addDocuments(project.id, [makeDoc()]);

      expect(updated.updatedAt >= before).toBe(true);
    });

    it('persists documents to the store', async () => {
      const project = await manager.create({
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Jane', email: 'jane@example.com' },
      });

      await manager.addDocuments(project.id, [makeDoc({ id: 'doc-persisted' })]);

      const loaded = await store.load(project.id);
      expect(loaded.documents[0].id).toBe('doc-persisted');
    });

    it('handles empty documents array without error', async () => {
      const project = await manager.create({
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Jane', email: 'jane@example.com' },
      });

      const updated = await manager.addDocuments(project.id, []);
      expect(updated.documents).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // cancel
  // ---------------------------------------------------------------------------

  describe('cancel()', () => {
    it('sets stage to CANCELLED', async () => {
      const project = await manager.create({
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Jane', email: 'jane@example.com' },
      });

      const cancelled = await manager.cancel(project.id);

      expect(cancelled.stage).toBe(PermitStage.CANCELLED);
    });

    it('persists the CANCELLED stage to the store', async () => {
      const project = await manager.create({
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Jane', email: 'jane@example.com' },
      });

      await manager.cancel(project.id);

      const loaded = await store.load(project.id);
      expect(loaded.stage).toBe(PermitStage.CANCELLED);
    });

    it('updates updatedAt on cancel', async () => {
      const project = await manager.create({
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Jane', email: 'jane@example.com' },
      });

      const before = project.updatedAt;
      await new Promise((r) => setTimeout(r, 5));
      const cancelled = await manager.cancel(project.id);

      expect(cancelled.updatedAt >= before).toBe(true);
    });

    it('throws when cancelling a non-existent project', async () => {
      await expect(manager.cancel('ghost-project')).rejects.toThrow('Project not found');
    });
  });

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  describe('list()', () => {
    beforeEach(async () => {
      await manager.create({
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Jane', email: 'jane@example.com' },
      });
      await manager.create({
        jurisdiction: 'Dallas, TX',
        permitTypes:  ['electrical'],
        applicant: { id: 'app-2', name: 'Bob', email: 'bob@example.com' },
      });
    });

    it('returns all projects when no filter', async () => {
      const projects = await manager.list();
      expect(projects).toHaveLength(2);
    });

    it('filters by stage', async () => {
      const projects = await manager.list({ stage: PermitStage.DISCOVER });
      expect(projects).toHaveLength(2);
    });

    it('filters by jurisdiction', async () => {
      const projects = await manager.list({ jurisdiction: 'Austin, TX' });
      expect(projects).toHaveLength(1);
      expect(projects[0].jurisdiction).toBe('Austin, TX');
    });

    it('filters by both stage and jurisdiction', async () => {
      const projects = await manager.list({
        stage:        PermitStage.DISCOVER,
        jurisdiction: 'Dallas, TX',
      });
      expect(projects).toHaveLength(1);
      expect(projects[0].jurisdiction).toBe('Dallas, TX');
    });

    it('returns empty array when no projects match filter', async () => {
      const projects = await manager.list({ jurisdiction: 'Phoenix, AZ' });
      expect(projects).toHaveLength(0);
    });

    it('returns empty array when store is empty', async () => {
      const freshStore   = new InMemoryStateStore();
      const freshManager = new ProjectManager(freshStore);
      const projects = await freshManager.list();
      expect(projects).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // save
  // ---------------------------------------------------------------------------

  describe('save()', () => {
    it('saves changes to an existing project and updates updatedAt', async () => {
      const project = await manager.create({
        jurisdiction: 'Austin, TX',
        permitTypes:  ['building'],
        applicant: { id: 'app-1', name: 'Jane', email: 'jane@example.com' },
      });

      const before = project.updatedAt;
      await new Promise((r) => setTimeout(r, 5));

      project.stage = PermitStage.PREPARE;
      await manager.save(project);

      const loaded = await store.load(project.id);
      expect(loaded.stage).toBe(PermitStage.PREPARE);
      expect(loaded.updatedAt >= before).toBe(true);
    });
  });
});
