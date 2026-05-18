import { PermitProject } from '../types';
import { StateStore, ProjectFilter } from './StateStore';

/**
 * Map-based in-memory implementation of StateStore.
 * Intended for testing and local development.
 * Not safe for concurrent writes across processes.
 */
export class InMemoryStateStore implements StateStore {
  private readonly store: Map<string, PermitProject> = new Map();

  async load(projectId: string): Promise<PermitProject> {
    const project = this.store.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    // Return a deep copy to prevent accidental mutation of stored state
    return JSON.parse(JSON.stringify(project)) as PermitProject;
  }

  async save(project: PermitProject): Promise<void> {
    // Store a deep copy so external mutation does not affect stored state
    this.store.set(project.id, JSON.parse(JSON.stringify(project)) as PermitProject);
  }

  async list(filter?: ProjectFilter): Promise<PermitProject[]> {
    const all = Array.from(this.store.values()).map(
      (p) => JSON.parse(JSON.stringify(p)) as PermitProject
    );

    if (!filter) return all;

    return all.filter((p) => {
      if (filter.stage !== undefined && p.stage !== filter.stage) return false;
      if (filter.jurisdiction !== undefined && p.jurisdiction !== filter.jurisdiction) return false;
      return true;
    });
  }

  async delete(projectId: string): Promise<void> {
    if (!this.store.has(projectId)) {
      throw new Error(`Project not found: ${projectId}`);
    }
    this.store.delete(projectId);
  }

  /** Expose size for testing */
  get size(): number {
    return this.store.size;
  }
}
