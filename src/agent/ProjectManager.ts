import { v4 as uuidv4 } from 'uuid';
import { PermitProject, PermitStage, Applicant, Document } from '../types';
import { StateStore } from '../state/StateStore';

export interface CreateProjectParams {
  jurisdiction:  string;
  permitTypes:   string[];
  applicant:     Applicant;
}

/**
 * CRUD helpers for PermitProject on top of StateStore.
 */
export class ProjectManager {
  constructor(private readonly store: StateStore) {}

  async create(params: CreateProjectParams): Promise<PermitProject> {
    const now = new Date().toISOString();
    const project: PermitProject = {
      id:           uuidv4(),
      stage:        PermitStage.DISCOVER,
      jurisdiction: params.jurisdiction,
      permitTypes:  params.permitTypes,
      applicant:    params.applicant,
      documents:    [],
      submissions:  [],
      corrections:  [],
      history:      [],
      createdAt:    now,
      updatedAt:    now,
    };
    await this.store.save(project);
    return project;
  }

  async get(projectId: string): Promise<PermitProject> {
    return this.store.load(projectId);
  }

  async addDocuments(projectId: string, documents: Document[]): Promise<PermitProject> {
    const project = await this.store.load(projectId);
    project.documents = [...project.documents, ...documents];
    project.updatedAt = new Date().toISOString();
    await this.store.save(project);
    return project;
  }

  async cancel(projectId: string): Promise<PermitProject> {
    const project = await this.store.load(projectId);
    project.stage = PermitStage.CANCELLED;
    project.updatedAt = new Date().toISOString();
    await this.store.save(project);
    return project;
  }

  async list(filter?: { jurisdiction?: string; stage?: PermitStage }): Promise<PermitProject[]> {
    return this.store.list(filter);
  }

  async save(project: PermitProject): Promise<void> {
    project.updatedAt = new Date().toISOString();
    await this.store.save(project);
  }
}
