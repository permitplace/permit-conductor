/**
 * GOAP Planner — BFS with cost accumulation.
 * Finds the lowest-cost plan from initialState to goal.
 * Returns [] when no plan exists (triggers escalation).
 *
 * Defined by ADR-002.
 */

import type { IAction } from './Action';
import type { CorrectionWorldState } from './WorldState';

const MAX_DEPTH = 10;

type PlanningState = Partial<CorrectionWorldState>;

/** Check whether all keys in `goal` are satisfied by `state`. */
function satisfiesGoal(
  state: PlanningState,
  goal: PlanningState,
): boolean {
  for (const key of Object.keys(goal) as Array<keyof CorrectionWorldState>) {
    if (state[key] !== goal[key]) return false;
  }
  return true;
}

/** Check whether all precondition keys are satisfied by `state`. */
function preconditionsMet(
  state: PlanningState,
  preconditions: Partial<CorrectionWorldState>,
): boolean {
  for (const key of Object.keys(preconditions) as Array<keyof CorrectionWorldState>) {
    if (state[key] !== preconditions[key]) return false;
  }
  return true;
}

/** Apply an action's effects to a copy of the state and return the new state. */
function applyEffects(
  state: PlanningState,
  effects: Partial<CorrectionWorldState>,
): PlanningState {
  return { ...state, ...effects };
}

interface SearchNode {
  state:   PlanningState;
  plan:    IAction[];
  cost:    number;
  depth:   number;
}

export class GOAPPlanner {
  /**
   * Find the lowest-cost ordered sequence of actions that transitions
   * `initialState` to satisfy `goal`.
   *
   * Uses BFS (breadth-first) over action combinations, tracking cumulative
   * cost to return the cheapest complete plan.
   */
  plan(
    initialState: CorrectionWorldState,
    goal: Partial<CorrectionWorldState>,
    availableActions: IAction[],
  ): IAction[] {
    // BFS queue — we explore by depth first, then select by cost
    const queue: SearchNode[] = [
      { state: { ...initialState }, plan: [], cost: 0, depth: 0 },
    ];

    let bestPlan: IAction[] | null = null;
    let bestCost = Infinity;

    while (queue.length > 0) {
      const node = queue.shift()!;

      // Prune: depth exceeded or already more expensive than best found
      if (node.depth >= MAX_DEPTH) continue;
      if (node.cost >= bestCost) continue;

      // Try each action
      for (const action of availableActions) {
        // Skip if already in plan at this node (avoid cycles)
        if (node.plan.includes(action)) continue;

        // Skip if preconditions not met
        if (!preconditionsMet(node.state, action.preconditions)) continue;

        const newState = applyEffects(node.state, action.effects);
        const newPlan  = [...node.plan, action];
        const newCost  = node.cost + action.cost;

        if (newCost >= bestCost) continue;

        if (satisfiesGoal(newState, goal)) {
          // Found a complete plan
          bestPlan = newPlan;
          bestCost = newCost;
        } else {
          queue.push({
            state: newState,
            plan:  newPlan,
            cost:  newCost,
            depth: node.depth + 1,
          });
        }
      }
    }

    return bestPlan ?? [];
  }
}
