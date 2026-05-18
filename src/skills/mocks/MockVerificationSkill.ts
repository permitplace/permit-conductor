/**
 * MockVerificationSkill — deterministic test double for IVerificationSkill.
 */

import { IVerificationSkill } from '../interfaces/IVerificationSkill';
import { VerificationStatus, SubmissionStatusCode } from '../../types';

export class MockVerificationSkill implements IVerificationSkill {
  /** Override to control the status code returned in tests */
  statusCode: SubmissionStatusCode = SubmissionStatusCode.APPROVED;

  /** Track all submissionIds passed to getStatus */
  calls: string[] = [];

  async getStatus(submissionId: string): Promise<VerificationStatus> {
    this.calls.push(submissionId);
    return {
      code:      this.statusCode,
      message:   `Verification status for ${submissionId}: ${this.statusCode}`,
      updatedAt: new Date().toISOString(),
    };
  }
}
