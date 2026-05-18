/**
 * permit-conductor — public API barrel export
 */

// Core types
export * from './types';

// Main entry point
export { PermitConductor } from './agent/PermitConductor';
export type { StartParams } from './agent/PermitConductor';

// Engine and manager (for advanced use / testing)
export { WorkflowEngine } from './agent/WorkflowEngine';
export { ProjectManager } from './agent/ProjectManager';
export type { CreateProjectParams } from './agent/ProjectManager';

// State stores
export { InMemoryStateStore } from './state/InMemoryStateStore';
export type { StateStore, ProjectFilter } from './state/StateStore';

// Skill interfaces
export type { IBrainSkill, ExplainCorrectionParams } from './skills/interfaces/IBrainSkill';
export type { ISubmissionSkill } from './skills/interfaces/ISubmissionSkill';
export type { IVerificationSkill } from './skills/interfaces/IVerificationSkill';
export type { IPlansReviewSkill } from './skills/interfaces/IPlansReviewSkill';

// GOAP (for custom action authoring)
export { GOAPPlanner } from './goap/GOAPPlanner';
export { GOAPExecutor } from './goap/GOAPExecutor';
export { buildWorldState } from './goap/WorldState';
export type { GOAPProject, Correction as GOAPCorrection } from './goap/WorldState';
export type { IAction, ActionContext, ActionResult } from './goap/Action';
