import { describe, expect, it } from 'vitest';
import { InvalidJobTransitionError, type JobStatus, jobStatus, transitionJob } from './job.js';

const states: JobStatus[] = [
  jobStatus.pending,
  jobStatus.running,
  jobStatus.completed,
  jobStatus.failed,
];

const validEdges: ReadonlyArray<[JobStatus, JobStatus]> = [
  [jobStatus.pending, jobStatus.running],
  [jobStatus.running, jobStatus.completed],
  [jobStatus.running, jobStatus.failed],
  [jobStatus.running, jobStatus.pending], // retry after backoff or lease reaped
];

const isValid = (from: JobStatus, to: JobStatus): boolean =>
  validEdges.some(([f, t]) => f === from && t === to);

describe('transitionJob', () => {
  for (const [from, to] of validEdges) {
    it(`should return ${to} for the valid edge ${from} -> ${to}`, () => {
      expect(transitionJob(from, to)).toBe(to);
    });
  }

  for (const from of states) {
    for (const to of states) {
      if (isValid(from, to)) continue;
      it(`should throw on the invalid edge ${from} -> ${to}`, () => {
        expect(() => transitionJob(from, to)).toThrow(InvalidJobTransitionError);
      });
    }
  }

  it('should reject pending -> failed (a job only fails after running)', () => {
    expect(() => transitionJob(jobStatus.pending, jobStatus.failed)).toThrow(
      InvalidJobTransitionError,
    );
  });

  it('should expose from and to on the thrown error', () => {
    try {
      transitionJob(jobStatus.completed, jobStatus.running);
      expect.unreachable('expected transitionJob to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidJobTransitionError);
      const typed = error as InvalidJobTransitionError;
      expect(typed.from).toBe(jobStatus.completed);
      expect(typed.to).toBe(jobStatus.running);
    }
  });
});
