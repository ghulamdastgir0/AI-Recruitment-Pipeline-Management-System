import { toCandidateStatus } from './candidate-status.util';

describe('toCandidateStatus', () => {
  it.each([
    ['APPLIED', 'APPLICATION_RECEIVED'],
    ['SCREENING', 'UNDER_REVIEW'],
    ['SCREENING_REJECTED', 'REJECTED'],
    ['INTERVIEW_PENDING', 'INTERVIEW_PENDING'],
    ['INTERVIEW_EXPIRED', 'REJECTED'],
    ['IN_REVIEW', 'INTERVIEW_COMPLETED'],
    ['MANAGER_REVIEW', 'FINAL_REVIEW'],
    ['NEXT_ROUND', 'INTERVIEW_PENDING'],
    ['SELECTED', 'ACCEPTED'],
    ['HIRED', 'ACCEPTED'],
    ['REJECTED', 'REJECTED'],
    ['WITHDRAWN', 'REJECTED'],
  ] as const)('maps %s -> %s', (internal, expected) => {
    expect(toCandidateStatus(internal)).toBe(expected);
  });

  it('falls back to UNDER_REVIEW for any unrecognized status', () => {
    expect(toCandidateStatus('SOMETHING_UNEXPECTED')).toBe('UNDER_REVIEW');
  });
});
