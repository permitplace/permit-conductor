/**
 * MockSubmissionSkill — deterministic test double for ISubmissionSkill.
 */

import { ISubmissionSkill } from '../interfaces/ISubmissionSkill';
import { Submission, SubmissionStatus, SubmissionStatusCode, PermitDocument } from '../../types';

export class MockSubmissionSkill implements ISubmissionSkill {
  private callCount = 0;

  async submit(_jurisdiction: string, _payload: Record<string, unknown>): Promise<Submission> {
    this.callCount += 1;
    return {
      id:          `sub-${this.callCount}`,
      submittedAt: new Date().toISOString(),
      status:      SubmissionStatusCode.SUBMITTED,
      referenceId: `REF-${this.callCount}`,
    };
  }

  async getStatus(submissionId: string): Promise<SubmissionStatus> {
    return {
      code:      SubmissionStatusCode.IN_REVIEW,
      message:   `Submission ${submissionId} is under review`,
      updatedAt: new Date().toISOString(),
    };
  }

  async retrieve(submissionId: string): Promise<PermitDocument> {
    return {
      id:       `permit-doc-${submissionId}`,
      url:      `https://permits.example.com/docs/${submissionId}.pdf`,
      issuedAt: new Date().toISOString(),
    };
  }

  async resubmit(_submissionId: string, _response: Record<string, unknown>): Promise<Submission> {
    this.callCount += 1;
    return {
      id:          `sub-resubmit-${this.callCount}`,
      submittedAt: new Date().toISOString(),
      status:      SubmissionStatusCode.SUBMITTED,
      referenceId: `REF-RESUBMIT-${this.callCount}`,
    };
  }
}
