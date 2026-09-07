/* Renders the guardrail visibly wherever a figure could not be sourced. */

import { Badge } from './ui/Badge';

export type BadgeKind = 'unvalidated' | 'proxy' | 'conflict';

const STYLES: Record<BadgeKind, { label: string; tone: 'danger' | 'warning' | 'accent' }> = {
  unvalidated: { label: 'UNVALIDATED', tone: 'danger' },
  proxy: { label: 'PROXY', tone: 'warning' },
  conflict: { label: 'SOURCES DISAGREE', tone: 'accent' },
};

export function kindFromReason(reason: string): BadgeKind {
  const text = reason.toUpperCase();
  if (text.includes('DISAGREE') || text.includes('CONFLICT')) return 'conflict';
  if (text.includes('PROXY')) return 'proxy';
  return 'unvalidated';
}

interface Props {
  kind?: BadgeKind;
  reason?: string;
  expanded?: boolean;
}

export function UnvalidatedBadge({ kind, reason, expanded = false }: Props) {
  const resolved = kind ?? (reason ? kindFromReason(reason) : 'unvalidated');
  const style = STYLES[resolved];

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, maxWidth: '100%' }}>
      {}
      <Badge tone={style.tone} title={reason} style={{ alignSelf: 'flex-start', cursor: reason ? 'help' : 'default', fontSize: 11, letterSpacing: '0.06em' }}>
        {style.label}
      </Badge>
      {expanded && reason && (
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>{reason}</span>
      )}
    </span>
  );
}
