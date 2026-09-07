

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../db/query', () => import('../test/fakeDb'));

import { db, reset, phase, project, type FakeAnswer } from '../test/fakeDb';
import { getQuestionsForPhase } from './questionBank.service';
import { approvePhase, revisePhase, canApprove, refreshPhaseStatus } from './gate.service';


const answersFor = (phaseNo: number, opts: { includeOptional?: boolean } = {}): FakeAnswer[] =>
  getQuestionsForPhase(phaseNo)
    .filter((q) => q.required || opts.includeOptional)
    .map((q) => ({ question_id: q.questionId, phase_no: phaseNo }));


const answersThrough = (upTo: number): FakeAnswer[] =>
  Array.from({ length: upTo }, (_, i) => answersFor(i + 1)).flat();


const approveError = async (phaseNo: number) =>
  approvePhase(1, phaseNo).then(() => null, (e: Error) => e.message);

beforeEach(() => reset());

describe('canApprove — completeness', () => {
  it('is false when a required question is unanswered', async () => {
    reset({ answers: answersFor(1).slice(0, -1) });
    expect(await canApprove(1, 1)).toBe(false);
  });

  it('is true once every required question is answered', async () => {
    reset({ answers: answersFor(1) });
    expect(await canApprove(1, 1)).toBe(true);
  });

  it('ignores optional questions', async () => {
    const optional = getQuestionsForPhase(3).filter((q) => !q.required);
    expect(optional.length).toBeGreaterThan(0);   

    reset({ currentPhase: 3, answers: [...answersThrough(2), ...answersFor(3)] });
    expect(await canApprove(1, 3)).toBe(true);
  });
});

describe('approvePhase — the invariant', () => {
  it('refuses a phase with unanswered required questions', async () => {
    reset({ answers: answersFor(1).slice(0, -1) });
    expect(await approveError(1)).toMatch(/unanswered required questions/);
    expect(phase(1).status).not.toBe('approved');
  });

  it('refuses a phase that is not unlocked yet', async () => {
    reset({ currentPhase: 1, answers: answersThrough(4) });
    expect(await approveError(3)).toMatch(/not unlocked yet/);
    expect(project().current_phase).toBe(1);
  });

  it('refuses to skip an earlier phase that is not approved', async () => {
    reset({
      currentPhase: 2,
      phases: { 1: 'revising', 2: 'awaiting_approval' },
      answers: answersThrough(2),
    });
    expect(await approveError(2)).toMatch(/Phase 1 must be approved first/);
    expect(phase(2).status).not.toBe('approved');
  });

  it('advances current_phase by exactly one and opens the next phase', async () => {
    reset({ answers: answersFor(1) });
    const result = await approvePhase(1, 1);

    expect(result).toEqual({ approved: 1, nextPhase: 2 });
    expect(phase(1).status).toBe('approved');
    expect(phase(1).approved_at).not.toBeNull();
    expect(project().current_phase).toBe(2);
    expect(phase(2).status).toBe('in_progress');
    expect(phase(3).status).toBe('pending');   
  });

  it('does not advance past the last phase, and completes the project', async () => {
    reset({ currentPhase: 4, answers: answersThrough(4) });
    const result = await approvePhase(1, 4);

    expect(result).toEqual({ approved: 4, nextPhase: null });
    expect(project().current_phase).toBe(4);
    expect(project().status).toBe('complete');
  });
});

describe('revisePhase', () => {
  it('returns the same phase to revising and clears approved_at', async () => {
    reset({ currentPhase: 2, answers: answersThrough(2) });
    await revisePhase(1, 1);

    expect(phase(1).status).toBe('revising');
    expect(phase(1).approved_at).toBeNull();
  });

  it('does not rewind current_phase', async () => {
    reset({ currentPhase: 4, answers: answersThrough(4) });
    await revisePhase(1, 2);
    expect(project().current_phase).toBe(4);
  });

  it('reopens a completed project', async () => {
    reset({
      currentPhase: 4, status: 'complete',
      phases: { 1: 'approved', 2: 'approved', 3: 'approved', 4: 'approved' },
      answers: answersThrough(4),
    });
    await revisePhase(1, 2);
    expect(project().status).toBe('in_progress');
  });

  it('404s on a phase that does not exist', async () => {
    await expect(revisePhase(1, 9)).rejects.toThrow(/Phase not found/);
  });
});


describe('revise then re-approve — the demo path', () => {
  it('re-approves the revised phase without rewinding the project', async () => {
    reset({
      currentPhase: 4, status: 'complete',
      phases: { 1: 'approved', 2: 'approved', 3: 'approved', 4: 'approved' },
      answers: answersThrough(4),
    });

    await revisePhase(1, 2);
    expect(project().current_phase).toBe(4);

    const result = await approvePhase(1, 2);

    expect(result).toEqual({ approved: 2, nextPhase: 3 });
    expect(phase(2).status).toBe('approved');
    expect(project().current_phase).toBe(4);   
    expect(phase(3).status).toBe('approved');  
    expect(phase(4).status).toBe('approved');
  });

  it('completes the project on the re-approval, not only on phase 4', async () => {
    reset({
      currentPhase: 4, status: 'complete',
      phases: { 1: 'approved', 2: 'approved', 3: 'approved', 4: 'approved' },
      answers: answersThrough(4),
    });

    await revisePhase(1, 2);
    expect(project().status).toBe('in_progress');

    await approvePhase(1, 2);
    expect(project().status).toBe('complete');
  });

  it('does not complete a project while another phase is still open', async () => {
    reset({
      currentPhase: 4,
      phases: { 1: 'approved', 2: 'approved', 3: 'revising', 4: 'approved' },
      answers: answersThrough(4),
    });
    await approvePhase(1, 2);
    expect(project().status).toBe('in_progress');
  });
});

describe('refreshPhaseStatus', () => {
  it('leaves an unreached phase pending', async () => {
    reset();
    expect(await refreshPhaseStatus(1, 3)).toBe('pending');
  });

  it('raises a complete phase to awaiting_approval', async () => {
    reset({ answers: answersFor(1) });
    expect(await refreshPhaseStatus(1, 1)).toBe('awaiting_approval');
    expect(phase(1).status).toBe('awaiting_approval');
  });

  it('drops an incomplete phase back to in_progress', async () => {
    reset({ phases: { 1: 'awaiting_approval' }, answers: answersFor(1).slice(0, -1) });
    expect(await refreshPhaseStatus(1, 1)).toBe('in_progress');
  });

  it('never reopens an approved phase', async () => {
    reset({ currentPhase: 2, phases: { 1: 'approved' }, answers: [] });
    expect(await refreshPhaseStatus(1, 1)).toBe('approved');
    expect(phase(1).status).toBe('approved');
  });
});

describe('the fake database itself', () => {
  it('covers every statement the gate issues', async () => {
    reset({ answers: answersFor(1) });
    await expect(approvePhase(1, 1)).resolves.toBeTruthy();
    expect(db.answers.length).toBeGreaterThan(0);
  });
});
