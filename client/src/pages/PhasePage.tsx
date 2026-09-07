/* The main screen. Renders a phase's questions and its gate. */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { PhaseStepper } from '../components/PhaseStepper';
import { QuestionField } from '../components/QuestionField';
import { ApprovalGate } from '../components/ApprovalGate';
import { useProject } from '../hooks/useProject';
import { useApprovePhase, usePhase, useRevisePhase } from '../hooks/usePhase';
import { useSaveAnswer } from '../hooks/useAnswers';
import { ApiError } from '../lib/api';
import type { AnswerValue } from '../lib/types';

export function PhasePage() {
  const params = useParams();
  const navigate = useNavigate();
  const projectId = Number(params.projectId);
  const phaseNo = Number(params.phaseNo);

  const project = useProject(projectId);
  const phase = usePhase(projectId, phaseNo);
  const saveAnswer = useSaveAnswer(projectId, phaseNo);
  const approve = useApprovePhase(projectId);
  const revise = useRevisePhase(projectId);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);

  useEffect(() => {
    if (project.isFetching) return;
    const current = project.data?.project.current_phase;
    if (current && phaseNo > current) {
      navigate(`/projects/${projectId}/phase/${current}`, { replace: true });
    }
  }, [project.data, project.isFetching, phaseNo, projectId, navigate]);

  if (project.isLoading || phase.isLoading) {
    return (
      <div style={wrap}>
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    );
  }

  if (project.error || phase.error || !project.data || !phase.data) {
    const err = (project.error ?? phase.error) as unknown;
    const message = err instanceof ApiError ? err.message : 'Could not load this phase.';
    return (
      <div style={wrap}>
        <p style={{ color: 'var(--danger-text)' }}>{message}</p>
        <Link to="/projects" style={{ color: 'var(--text-link)', fontSize: 14 }}>Back to your projects</Link>
      </div>
    );
  }

  const { project: proj, phases, phaseMeta } = project.data;
  const { questions, answers, canApprove, meta } = phase.data;
  const answerFor = (questionId: string) => answers.find((a) => a.question_id === questionId);

  const locked = phase.data.phase.status === 'approved';

  async function save(questionId: string, value: AnswerValue) {
    setSavingId(questionId);
    setFieldErrors((prev) => ({ ...prev, [questionId]: '' }));
    try {
      await saveAnswer.mutateAsync({ questionId, value });
    } catch (err) {
      setFieldErrors((prev) => ({
        ...prev,
        [questionId]: err instanceof ApiError ? err.message : 'Could not save this answer.',
      }));
    } finally {
      setSavingId(null);
    }
  }

  async function onApprove() {
    setGateError(null);
    try {
      const result = await approve.mutateAsync(phaseNo);
      if (result.nextPhase) navigate(`/projects/${projectId}/phase/${result.nextPhase}`);
      else navigate(`/projects/${projectId}/documents`);
    } catch (err) {
      setGateError(err instanceof ApiError ? err.message : 'Could not approve this phase.');
    }
  }

  async function onRevise() {
    setGateError(null);
    try { await revise.mutateAsync(phaseNo); }
    catch (err) {
      setGateError(err instanceof ApiError ? err.message : 'Could not reopen this phase.');
    }
  }

  const allApproved = phases.every((p) => p.status === 'approved');

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 780, margin: '0 auto', width: '100%' }}>
        <header style={{ marginBottom: 22 }}>
          <Link to="/projects" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>
            ← Your projects
          </Link>
          <h1
            style={{
              margin: '8px 0 4px',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 'var(--text-h2-size)',
              letterSpacing: 'var(--text-h2-ls)',
              color: 'var(--text-primary)',
            }}
          >
            {proj.name}
          </h1>
          {allApproved && (
            <Link
              to={`/projects/${projectId}/documents`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--text-link)',
                textDecoration: 'none',
              }}
            >
              All four phases approved — go to documents <ArrowRight size={14} />
            </Link>
          )}
        </header>

        <PhaseStepper project={proj} phases={phases} phaseMeta={phaseMeta} current={phaseNo} />

        <section style={{ marginBottom: 20 }}>
          <h2
            style={{
              margin: '0 0 4px',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 19,
              color: 'var(--text-primary)',
            }}
          >
            Phase {phaseNo}{meta ? ` — ${meta.name}` : ''}
          </h2>
          {meta && <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14.5, lineHeight: 1.6 }}>{meta.description}</p>}
          {locked && (
            <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--success-text)', fontWeight: 600 }}>
              ✓ Approved and locked. Use "Revise this phase" below to edit these answers.
            </p>
          )}
        </section>

        {questions.map((question) => (
          <QuestionField
            key={question.questionId}
            question={question}
            answer={answerFor(question.questionId)}
            onSave={(value) => save(question.questionId, value)}
            saving={savingId === question.questionId}
            disabled={locked}
            error={fieldErrors[question.questionId] || undefined}
          />
        ))}

        <ApprovalGate
          phase={phase.data.phase}
          questions={questions}
          answers={answers}
          canApprove={canApprove}
          onApprove={onApprove}
          onRevise={onRevise}
          busy={approve.isPending || revise.isPending}
          error={gateError ?? undefined}
        />
      </div>
    </div>
  );
}

const wrap = { flex: 1, overflow: 'auto', padding: '28px 20px 72px' } as const;
