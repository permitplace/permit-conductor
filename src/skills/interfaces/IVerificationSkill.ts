import { VerificationStatus } from '../../types';

export interface IVerificationSkill {
  /**
   * Get the current verification/review status of a submitted application.
   */
  getStatus(submissionId: string): Promise<VerificationStatus>;
}
