import { ComplianceResult, Document } from '../../types';

export interface IPlansReviewSkill {
  /**
   * Run a compliance check on plan documents against jurisdiction requirements.
   */
  checkCompliance(
    documents: Document[],
    jurisdiction: string
  ): Promise<ComplianceResult>;
}
