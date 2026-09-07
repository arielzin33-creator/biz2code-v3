/* The brand's action control — TS port of the design system's Button.jsx. */

import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const SIZES: Record<Size, { padding: string; fontSize: number }> = {
  sm: { padding: '8px 18px', fontSize: 13 },
  md: { padding: '13px 28px', fontSize: 14 },
  lg: { padding: '16px 34px', fontSize: 15 },
};

const VARIANTS: Record<Variant, React.CSSProperties> = {
  primary: {
    background: 'var(--gradient-primary)',
    color: 'var(--text-on-accent)',
    border: '1.5px solid transparent',
    boxShadow: 'var(--shadow-cta-primary)',
  },
  secondary: {
    background: 'var(--gradient-secondary)',
    color: 'var(--text-on-accent)',
    border: '1.5px solid transparent',
    boxShadow: 'var(--shadow-cta-secondary)',
  },
  ghost: {
    background: 'var(--control-bg)',
    color: 'var(--navy-700)',
    border: '1.5px solid var(--border-subtle)',
    boxShadow: 'none',
  },
  quiet: {
    background: 'transparent',
    color: 'var(--text-link)',
    border: '1.5px solid transparent',
    boxShadow: 'none',
  },
  danger: {
    background: 'var(--danger-bg)',
    color: 'var(--danger-text)',
    border: '1.5px solid var(--danger-border)',
    boxShadow: 'none',
  },
};

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  variant?: Variant;
  size?: Size;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  style?: React.CSSProperties;
}

export function Button({
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  type = 'button',
  style,
  children,
  ...rest
}: Props) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);
  const v = VARIANTS[variant];
  const s = SIZES[size];
  const inert = disabled || loading;

  const lift = !inert && hover && !press;
  const hoverTint =
    !inert && hover && (variant === 'ghost' || variant === 'quiet')
      ? { background: 'var(--control-bg-hover)' }
      : null;

  return (
    <button
      type={type}
      disabled={inert}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        display: fullWidth ? 'flex' : 'inline-flex',
        width: fullWidth ? '100%' : undefined,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontFamily: 'var(--font-ui)',
        fontWeight: 600,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        borderRadius: 'var(--radius-pill)',
        cursor: inert ? 'not-allowed' : 'pointer',
        opacity: inert ? 0.5 : 1,
        transform: lift ? 'translateY(-1px)' : 'translateY(0)',
        filter: press ? 'brightness(.94)' : hover && !inert ? 'brightness(1.04)' : 'none',
        transition: 'var(--transition-control)',
        ...v,
        ...s,
        ...hoverTint,
        ...style,
      }}
      {...rest}
    >
      {loading ? <Spin /> : iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

function Spin() {
  return (
    <span
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        animation: 'b2c-spin .7s linear infinite',
        display: 'inline-block',
      }}
    />
  );
}
