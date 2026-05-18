import { Submission, SubmissionStatus, PermitDocument } from '../../types';

export interface ISubmissionSkill {
  /**
   * Submit a permit application payload to the jurisdiction.
   */
  submit(
    jurisdiction: string,
    payload: Record<string, unknown>
  ): Promise<Submission>;

  /**
   * Get the current status of a submission.
   */
  getStatus(submissionId: string): Promise<SubmissionStatus>;

  /**
   * Retrieve the approved permit document once the submission is approved.
   */
  retrieve(submissionId: string): Promise<PermitDocument>;

  /**
   * Resubmit an application after corrections have been resolved.
   */
  resubmit(
    submissionId: string,
    response: Record<string, unknown>
  ): Promise<Submission>;
}
