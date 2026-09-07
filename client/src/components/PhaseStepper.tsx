/* Shows the four phases and the current position. */

import { Link } from 'react-router-dom';
import type { Phase, PhaseMeta, Project } from '../lib/types';
import { PHASE_STATUS_LABELS } from '../lib/types';

const COLOURS: Record<Phase['status'], string> = {
  pending: 'var(--n-400)',
  in_progress: 'var(--cyan-600)',
  awaiting_approval: 'var(--warning-text)',
  approved: 'var(--success-text)',
  revising: 'var(--warning-text)',
};

interface Props {
  project: Project;
  phases: Phase[];
  phaseMeta: PhaseMeta[];
  current: number;
}

export function PhaseStepper({ project, phases, phaseMeta, current }: Props) {
  return (
    <nav
      aria-label="Phases"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 8,
        marginBottom: 24,
        alignItems: 'stretch',
      }}
    >
      {phases.map((phase) => {
        const meta = phaseMeta.find((m) => m.order === phase.phase_no);
        const reachable = phase.phase_no <= project.current_phase;
        const isCurrent = phase.phase_no === current;
        const colour = COLOURS[phase.status];

        const body = (
          <>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span
                aria-hidden
                style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  display: 'grid', placeItems: 'center',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 12, fontWeight: 700,
                  background: phase.status === 'approved' ? 'var(--success-text)' : 'transparent',
                  color: phase.status === 'approved' ? '#fff' : colour,
                  border: `1.5px solid ${colour}`,
                }}
              >
                {phase.status === 'approved' ? '✓' : phase.phase_no}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontWeight: isCurrent ? 700 : 500,
                  fontSize: 14,
                  minWidth: 0,
                  color: 'var(--text-primary)',
                }}
              >
                {meta?.name ?? `Phase ${phase.phase_no}`}
              </span>
            </span>
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: colour, marginTop: 4, display: 'block' }}>
              {PHASE_STATUS_LABELS[phase.status]}
            </span>
          </>
        );

        const shared = {
          minWidth: 0,          
          padding: '10px 12px',
          borderRadius: 'var(--radius-control)',
          border: `1.5px solid ${isCurrent ? colour : 'var(--border-subtle)'}`,
          background: isCurrent ? 'var(--surface-accent-soft)' : 'var(--surface-card)',
          textAlign: 'left' as const,
          transition: 'var(--transition-control)',
        };

        return reachable ? (
          <Link
            key={phase.phase_no}
            to={`/projects/${project.id}/phase/${phase.phase_no}`}
            aria-current={isCurrent ? 'step' : undefined}
            style={{ ...shared, color: 'var(--text-primary)', textDecoration: 'none', display: 'block' }}
          >
            {body}
          </Link>
        ) : (
          <div
            key={phase.phase_no}
            aria-disabled
            title="Approve the previous phase to unlock this one"
            style={{ ...shared, color: 'var(--text-muted)', opacity: 0.6 }}
          >
            {body}
          </div>
        );
      })}
    </nav>
  );
}
