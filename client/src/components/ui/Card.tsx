/* Quiet surface: 14px radius, hairline border, near-invisible shadow. Never glossy. */

import { useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

interface Props extends Omit<AnchorHTMLAttributes<HTMLDivElement>, 'style' | 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  accent?: 'navy' | 'cyan';
  actions?: ReactNode;
  footer?: ReactNode;
  padding?: string;
  interactive?: boolean;
  style?: React.CSSProperties;
  children?: ReactNode;
}

export function Card({
  title,
  subtitle,
  accent,
  actions,
  footer,
  padding = 'var(--card-padding)',
  interactive = false,
  children,
  style,
  ...rest
}: Props) {
  const [hover, setHover] = useState(false);
  const accentColor = accent === 'navy' ? 'var(--navy-500)' : accent === 'cyan' ? 'var(--cyan-500)' : null;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-card)',
        padding,
        boxShadow: interactive && hover ? 'var(--shadow-raised)' : 'var(--shadow-hairline)',
        borderColor: interactive && hover ? 'var(--border-default)' : 'var(--border-subtle)',
        cursor: interactive ? 'pointer' : 'default',
        transition: 'var(--transition-control)',
        fontFamily: 'var(--font-ui)',
        ...style,
      }}
      {...rest}
    >
      {accentColor && (
        <div style={{ height: 4, width: 44, borderRadius: 4, background: accentColor, marginBottom: 14 }} />
      )}
      {(title || actions) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: subtitle || children ? 8 : 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && (
              <h3
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: 16,
                  lineHeight: 1.35,
                  color: 'var(--navy-800)',
                }}
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p style={{ margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div style={{ display: 'flex', gap: 8, flex: 'none' }}>{actions}</div>}
        </div>
      )}
      {children}
      {footer && (
        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
