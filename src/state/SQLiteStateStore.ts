import Database, { Database as DatabaseType } from 'better-sqlite3';
import { PermitProject, PermitStage } from '../types';
import { StateStore, ProjectFilter } from './StateStore';

export interface SQLiteStateStoreOptions {
  /**
   * Path to the SQLite database file.
   * Defaults to ':memory:' for ephemeral/test use.
   */
  path?: string;
}

interface ProjectRow {
  data: string;
}

/**
 * SQLite-backed implementation of StateStore using better-sqlite3.
 * The better-sqlite3 API is synchronous; each method wraps the result
 * in Promise.resolve() to satisfy the async StateStore interface.
 *
 * Suitable for embedded deployments and edge environments where a
 * full Postgres server is not available.
 */
export class SQLiteStateStore implements StateStore {
  private readonly db: DatabaseType;

  constructor(options: SQLiteStateStoreOptions = {}) {
    const dbPath = options.path ?? ':memory:';
    this.db = new Database(dbPath);
    this.initSchema();
  }

  /**
   * Creates the permit_projects table and indexes if they do not exist.
   * Called synchronously in the constructor so the store is immediately usable.
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS permit_projects (
        id           TEXT PRIMARY KEY,
        stage        TEXT NOT NULL,
        jurisdiction TEXT NOT NULL,
        data         TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_permit_projects_stage
        ON permit_projects (stage);
    `);
  }

  async load(projectId: string): Promise<PermitProject> {
    const row = this.db
      .prepare('SELECT data FROM permit_projects WHERE id = ?')
      .get(projectId) as ProjectRow | undefined;

    if (!row) {
      throw new Error(`Project not found: ${projectId}`);
    }

    return JSON.parse(row.data) as PermitProject;
  }

  async save(project: PermitProject): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO permit_projects (id, stage, jurisdiction, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE
           SET stage        = excluded.stage,
               jurisdiction = excluded.jurisdiction,
               data         = excluded.data,
               updated_at   = excluded.updated_at`
      )
      .run(
        project.id,
        project.stage,
        project.jurisdiction,
        JSON.stringify(project),
        project.createdAt,
        project.updatedAt
      );

    return Promise.resolve();
  }

  async list(filter?: ProjectFilter): Promise<PermitProject[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.stage !== undefined) {
      conditions.push('stage = ?');
      params.push(filter.stage);
    }

    if (filter?.jurisdiction !== undefined) {
      conditions.push('jurisdiction = ?');
      params.push(filter.jurisdiction);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT data FROM permit_projects ${where} ORDER BY created_at ASC`;

    const rows = this.db.prepare(sql).all(...params) as ProjectRow[];
    return Promise.resolve(rows.map((row) => JSON.parse(row.data) as PermitProject));
  }

  async delete(projectId: string): Promise<void> {
    const result = this.db
      .prepare('DELETE FROM permit_projects WHERE id = ?')
      .run(projectId);

    if (result.changes === 0) {
      throw new Error(`Project not found: ${projectId}`);
    }

    return Promise.resolve();
  }

  /**
   * Closes the underlying SQLite database connection.
   * Call when the store is no longer needed (e.g., process shutdown).
   */
  close(): void {
    this.db.close();
  }
}
