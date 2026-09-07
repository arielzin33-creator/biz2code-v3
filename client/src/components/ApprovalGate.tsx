/* Approve / Revise controls at the foot of a phase. */

import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Question, Answer, Phase } from '../lib/types';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

interface Props {
  phase: Phase;
  questions: Question[];
  answers: Answer[];
  canApprove: boolean;
  onApprove: () => void;
  onRevise: () => void;
  busy: boolean;
  error?: string;
}

export function ApprovalGate({
  phase, questions, answers, canApprove, onApprove, onRevise, busy, error,
}: Props) {
  const [confirmingRevise, setConfirmingRevise] = useState(false);

  const answered = new Set(answers.map((a) => a.question_id));
  const missing = questions.filter((q) => q.required && !answered.has(q.questionId));

  const approved = phase.status === 'approved';

  return (
    <Card style={{ marginTop: 8 }}>
      {approved ? (
        <>
          <p style={{ margin: '0 0 12px', color: 'var(--success-text)', fontWeight: 700, fontFamily: 'var(--font-ui)', fontSize: 14.5 }}>
            ✓ This phase is approved
            {phase.approved_at && (
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                {' '}on {new Date(phase.approved_at).toLocaleString()}
              </span>
            )}
          </p>
          <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Answers are locked. Revising reopens this phase so you can change them; the
            documents already generated are kept, and regenerating adds a new version
            beside them.
          </p>
          {confirmingRevise ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontFamily: 'var(--font-ui)', color: 'var(--text-primary)' }}>
                Reopen this phase for editing?
              </span>
              <Button variant="danger" size="sm" disabled={busy} onClick={onRevise}>
                {busy ? 'Reopening…' : 'Yes, revise'}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmingRevise(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" iconLeft={<RotateCcw size={14} />} disabled={busy} onClick={() => setConfirmingRevise(true)}>
              Revise this phase
            </Button>
          )}
        </>
      ) : (
        <>
          {missing.length > 0 && (
            <div role="status" aria-live="polite" style={{ marginBottom: 16 }}>
              <p style={{ margin: '0 0 6px', fontWeight: 700, fontFamily: 'var(--font-ui)', fontSize: 14.5, color: 'var(--text-primary)' }}>
                {missing.length} required {missing.length === 1 ? 'question is' : 'questions are'} unanswered
              </p>
              <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-secondary)', fontSize: 14 }}>
                {missing.map((q) => <li key={q.questionId}>{q.text}</li>)}
              </ul>
            </div>
          )}

          <Button
            variant={canApprove ? 'primary' : 'ghost'}
            onClick={onApprove}
            disabled={!canApprove || busy}
            loading={busy}
            title={canApprove ? 'Approve this phase and unlock the next' : 'Answer every required question first'}
          >
            Approve this phase
          </Button>

          {!canApprove && missing.length === 0 && (
            <p role="status" aria-live="polite" style={{ margin: '12px 0 0', fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Every question here is answered, but an earlier phase is not approved.
              Approve the earlier phases first.
            </p>
          )}
        </>
      )}

      {error && (
        <p role="alert" style={{ margin: '14px 0 0', color: 'var(--danger-text)', fontSize: 13.5 }}>{error}</p>
      )}
    </Card>
  );
}
