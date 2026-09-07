/* Status pill. Flat fill + hairline border — never the gloss gradient. */

import type { HTMLAttributes, ReactNode } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

const TONES: Record<Tone, { background: string; color: string; border: string }> = {
  info: { background: 'var(--info-bg)', color: 'var(--info-text)', border: 'var(--info-border)' },
  success: { background: 'var(--success-bg)', color: 'var(--success-text)', border: 'var(--success-border)' },
  warning: { background: 'var(--warning-bg)', color: 'var(--warning-text)', border: 'var(--warning-border)' },
  danger: { background: 'var(--danger-bg)', color: 'var(--danger-text)', border: 'var(--danger-border)' },
  neutral: { background: 'var(--n-100)', color: 'var(--n-600)', border: 'var(--n-200)' },
  accent: { background: 'var(--cyan-50)', color: 'var(--cyan-700)', border: 'var(--cyan-200)' },
};

interface Props extends Omit<HTMLAttributes<HTMLSpanElement>, 'style'> {
  tone?: Tone;
  dot?: boolean;
  icon?: ReactNode;
  style?: React.CSSProperties;
}

export function Badge({ tone = 'neutral', dot = false, icon, children, style, ...rest }: Props) {
  const t = TONES[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 13px',
        borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-ui)',
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.35,
        whiteSpace: 'nowrap',
        background: t.background,
        color: t.color,
        border: `1px solid ${t.border}`,
        ...style,
      }}
      {...rest}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flex: 'none' }} />}
      {icon}
      {children}
    </span>
  );
}
