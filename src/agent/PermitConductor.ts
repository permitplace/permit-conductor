/**
 * PermitConductor — main entry point for the permit orchestration engine.
 * Wraps WorkflowEngine with EventEmitter3 and StateStore persistence.
 */

import EventEmitter from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
  PermitProject,
  PermitStage,
  StageResult,
  Applicant,
  Document,
  ConductorConfig,
  ConductorEvent,
} from '../types';
import { WorkflowEngine } from './WorkflowEngine';
import { ProjectManager } from './ProjectManager';

export interface StartParams {
  jurisdiction: string;
  permitTypes:  string[];
  applicant:    Applicant;
}

// Typed event map for EventEmitter3
type EventMap = {
  [K in ConductorEvent['type']]: [Extract<ConductorEvent, { type: K }>['payload']];
};

export class PermitConductor extends EventEmitter<EventMap> {
  private readonly engine:  WorkflowEngine;
  private readonly manager: ProjectManager;
  private readonly config:  ConductorConfig;

  constructor(config: ConductorConfig) {
    super();
    this.config  = config;
    this.engine  = new WorkflowEngine();
    this.manager = new ProjectManager(config.stateStore);
  }

  /**
   * Create a new permit project and advance to PREPARE.
   */
  async start(params: StartParams): Promise<PermitProject> {
    const project = await this.manager.create(params);
    await this.config.stateStore.save(project);

    const result = await this.engine.processStage(project, this.config, this.emitEvent.bind(this));
    await this.config.stateStore.save(result.project);

    return result.project;
  }

  /**
   * Advance the current stage of an existing project.
   */
  async advance(projectId: string): Promise<StageResult> {
    const project = await this.config.stateStore.load(projectId);
    const result  = await this.engine.processStage(project, this.config, this.emitEvent.bind(this));
    await this.config.stateStore.save(result.project);
    return result;
  }

  /**
   * Add documents to a project. Re-runs PREPARE checklist validation if in PREPARE stage.
   */
  async uploadDocuments(projectId: string, documents: Document[]): Promise<void> {
    const project = await this.config.stateStore.load(projectId);

    // Attach documents
    for (const doc of documents) {
      if (!doc.id) {
        (doc as { id: string }).id = uuidv4();
      }
      if (!doc.uploadedAt) {
        (doc as { uploadedAt: string }).uploadedAt = new Date().toISOString();
      }
      project.documents.push(doc);
    }

    project.updatedAt = new Date().toISOString();
    await this.config.stateStore.save(project);

    // If we were waiting for documents, re-check checklist
    if (project.stage === PermitStage.PREPARE && project.checklist) {
      const checklist = project.checklist;
      const docTypes  = new Set(project.documents.map((d) => d.type));

      for (const item of checklist.items) {
        if (docTypes.has(item.documentType)) {
          item.satisfied = true;
        }
      }
      checklist.missing = checklist.items.filter((i) => !i.satisfied);
      project.checklist = checklist;
      await this.config.stateStore.save(project);
    }
  }

  /**
   * Mark a correction as resolved by the user. Resumes GOAP execution.
   */
  async resolveCorrection(projectId: string, correctionId: string): Promise<void> {
    const project    = await this.config.stateStore.load(projectId);
    const correction = project.corrections.find((c) => c.id === correctionId);
    if (!correction) {
      throw new Error(`Correction not found: ${correctionId}`);
    }

    correction.resolvedAt = new Date().toISOString();

    // Mark userActionComplete in goapState so engine can continue
    if (project.goapState) {
      project.goapState.userActionComplete = true;
    }

    project.updatedAt = new Date().toISOString();
    await this.config.stateStore.save(project);
  }

  /**
   * Get a project by ID.
   */
  async getProject(projectId: string): Promise<PermitProject> {
    return this.config.stateStore.load(projectId);
  }

  /**
   * Internal emit bridge — maps engine string events to typed EventEmitter3 events.
   */
  private emitEvent(event: string, payload?: unknown): void {
    // EventEmitter3 emit is generic; we cast the event name and payload
    this.emit(event as ConductorEvent['type'], payload as never);
  }
}
