import { Pool, PoolConfig } from 'pg';
import { PermitProject, PermitStage } from '../types';
import { StateStore, ProjectFilter } from './StateStore';

export interface PostgresStateStoreOptions {
  connectionString?: string;
  pool?: Pool;
}

/**
 * PostgreSQL-backed implementation of StateStore.
 * Uses a single permit_projects table with a JSONB column for flexible schema evolution.
 * Suitable for production deployments.
 */
export class PostgresStateStore implements StateStore {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(options: PostgresStateStoreOptions) {
    if (options.pool) {
      this.pool = options.pool;
      this.ownsPool = false;
    } else if (options.connectionString) {
      const config: PoolConfig = { connectionString: options.connectionString };
      this.pool = new Pool(config);
      this.ownsPool = true;
    } else {
      throw new Error('PostgresStateStore requires either a connectionString or a pool');
    }
  }

  /**
   * Creates the permit_projects table and indexes if they do not already exist.
   * Call this once on startup before the store is used.
   */
  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS permit_projects (
        id           TEXT PRIMARY KEY,
        stage        TEXT NOT NULL,
        jurisdiction TEXT NOT NULL,
        data         JSONB NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_permit_projects_stage
        ON permit_projects (stage);
    `);
  }

  async load(projectId: string): Promise<PermitProject> {
    const result = await this.pool.query<{ data: PermitProject }>(
      'SELECT data FROM permit_projects WHERE id = $1',
      [projectId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Project not found: ${projectId}`);
    }

    return result.rows[0].data as PermitProject;
  }

  async save(project: PermitProject): Promise<void> {
    await this.pool.query(
      `INSERT INTO permit_projects (id, stage, jurisdiction, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET stage        = EXCLUDED.stage,
             jurisdiction = EXCLUDED.jurisdiction,
             data         = EXCLUDED.data,
             updated_at   = EXCLUDED.updated_at`,
      [
        project.id,
        project.stage,
        project.jurisdiction,
        JSON.stringify(project),
        project.createdAt,
        project.updatedAt,
      ]
    );
  }

  async list(filter?: ProjectFilter): Promise<PermitProject[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filter?.stage !== undefined) {
      conditions.push(`stage = $${paramIndex++}`);
      params.push(filter.stage);
    }

    if (filter?.jurisdiction !== undefined) {
      conditions.push(`jurisdiction = $${paramIndex++}`);
      params.push(filter.jurisdiction);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT data FROM permit_projects ${where} ORDER BY created_at ASC`;

    const result = await this.pool.query<{ data: PermitProject }>(sql, params);
    return result.rows.map((row) => row.data as PermitProject);
  }

  async delete(projectId: string): Promise<void> {
    const result = await this.pool.query(
      'DELETE FROM permit_projects WHERE id = $1',
      [projectId]
    );

    if (result.rowCount === 0) {
      throw new Error(`Project not found: ${projectId}`);
    }
  }

  /**
   * Closes the underlying pool if this store owns it.
   * Safe to call on stores that received an external pool (no-op).
   */
  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }
}
