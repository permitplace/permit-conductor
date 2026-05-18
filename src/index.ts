/**
 * permit-conductor — public API barrel export
 */

// Core engine
export { PermitConductor } from './agent/PermitConductor';
export type { StartParams } from './agent/PermitConductor';
export { WorkflowEngine } from './agent/WorkflowEngine';

// Engine manager (advanced use / testing)
export { ProjectManager } from './agent/ProjectManager';
export type { CreateProjectParams } from './agent/ProjectManager';

// GOAP
export { GOAPPlanner } from './goap/GOAPPlanner';
export { GOAPExecutor } from './goap/GOAPExecutor';
export { buildWorldState } from './goap/WorldState';
export type { GOAPProject, Correction as GOAPCorrection } from './goap/WorldState';
export type { IAction, ActionContext, ActionResult } from './goap/Action';
export * from './goap/actions';

// Skill interfaces (type-only — no runtime cost)
export type { IBrainSkill, ExplainCorrectionParams } from './skills/interfaces/IBrainSkill';
export type { ISubmissionSkill }   from './skills/interfaces/ISubmissionSkill';
export type { IVerificationSkill } from './skills/interfaces/IVerificationSkill';
export type { IPlansReviewSkill }  from './skills/interfaces/IPlansReviewSkill';

// State
export type { StateStore, ProjectFilter } from './state/StateStore';
export { InMemoryStateStore }      from './state/InMemoryStateStore';
export { PostgresStateStore }      from './state/PostgresStateStore';
export { SQLiteStateStore }        from './state/SQLiteStateStore';

// All shared types
export * from './types';
