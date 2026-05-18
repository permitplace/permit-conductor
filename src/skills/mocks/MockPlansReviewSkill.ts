/**
 * MockPlansReviewSkill — deterministic test double for IPlansReviewSkill.
 */

import { IPlansReviewSkill } from '../interfaces/IPlansReviewSkill';
import { ComplianceResult, Document } from '../../types';

export class MockPlansReviewSkill implements IPlansReviewSkill {
  /** Override to control whether compliance passes in tests */
  passed = true;

  /** Unused by the mock but kept for API compatibility with test overrides */
  score = 95;

  /** Track all calls: each entry records [documents, jurisdiction] */
  calls: Array<{ documents: Document[]; jurisdiction: string }> = [];

  async checkCompliance(
    documents: Document[],
    jurisdiction: string,
  ): Promise<ComplianceResult> {
    this.calls.push({ documents, jurisdiction });
    return {
      passed:   this.passed,
      failures: this.passed ? [] : [{ code: 'MOCK_FAILURE', description: 'Mock compliance failure' }],
    };
  }
}
