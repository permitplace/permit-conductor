import { PermitProject, PermitStage } from '../types';

export interface ProjectFilter {
  stage?:        PermitStage;
  jurisdiction?: string;
}

/**
 * Abstract persistence contract for PermitProject state.
 * Default: InMemoryStateStore (testing / local dev)
 * Production: PostgresStateStore, SQLiteStateStore
 */
export interface StateStore {
  load(projectId: string): Promise<PermitProject>;
  save(project: PermitProject): Promise<void>;
  list(filter?: ProjectFilter): Promise<PermitProject[]>;
  delete(projectId: string): Promise<void>;
}
