/* Renders one question by its type: text | select | multiselect | number | range. */

import { useEffect, useState, type CSSProperties } from 'react';
import type { Answer, AnswerValue, Question, RangeValue } from '../lib/types';

interface Props {
  question: Question;
  answer: Answer | undefined;
  onSave: (value: AnswerValue) => void;
  saving: boolean;
  disabled: boolean;
  error?: string;
}

const isRange = (v: unknown): v is RangeValue =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
  && 'min' in v && 'max' in v;

function toInputValue(
  question: Question, answer: Answer | undefined,
): string | string[] | RangeValue {
  if (question.type === 'range') {
    const stored = answer?.value_json;
    return isRange(stored) ? stored : { min: NaN, max: NaN };
  }
  if (!answer) return question.type === 'multiselect' ? [] : '';
  if (question.type === 'multiselect') return answer.value_json ?? [];
  if (question.type === 'number') return answer.value_number ?? '';
  return answer.value_text ?? '';
}

const bothBoundsGiven = (r: RangeValue) => Number.isFinite(r.min) && Number.isFinite(r.max);

const labelStyle: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-ui)',
  fontWeight: 600,
  fontSize: 'var(--text-label-size)',
  color: 'var(--text-primary)',
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '13px 14px',
  borderRadius: 'var(--radius-control)',
  border: '1.5px solid var(--control-border)',
  background: 'var(--control-bg)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-ui)',
  fontSize: 14,
};

export function QuestionField({ question, answer, onSave, saving, disabled, error }: Props) {
  const [value, setValue] = useState<string | string[] | RangeValue>(
    () => toInputValue(question, answer),
  );

  const stored = toInputValue(question, answer);
  const storedKey = Array.isArray(stored)
    ? stored.join(' ')
    : isRange(stored) ? `${stored.min}:${stored.max}` : stored;
  useEffect(() => { setValue(stored);  }, [storedKey]);

  const commit = (next: AnswerValue) => {
    if (disabled) return;
    const unchanged = Array.isArray(next)
      ? Array.isArray(stored) && next.join(' ') === stored.join(' ')
      : isRange(next)
        ? isRange(stored) && next.min === stored.min && next.max === stored.max
        : String(next) === String(stored);
    if (unchanged) return;                 
    if (typeof next === 'string' && next.trim() === '') return;   
    if (Array.isArray(next) && next.length === 0) return;
    onSave(next);
  };

  const id = `q-${question.questionId}`;
  /*
    multiselect and range render a GROUP of controls, not one labelable
    element, so the outer <label for=...> had nothing to point at — clicking
    the question text did nothing and the group had no accessible name. Those
    two types get role="group" + aria-labelledby on the container instead.
   */
  const isGroup = question.type === 'multiselect' || question.type === 'range';

  return (
    <fieldset
      disabled={disabled}
      style={{
        border: `1.5px solid ${error ? 'var(--danger-border)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-card)',
        background: 'var(--surface-card)',
        boxShadow: 'var(--shadow-hairline)',
        padding: 18, margin: '0 0 14px', minWidth: 0,
      }}
    >
      <label htmlFor={isGroup ? undefined : id} id={`${id}-label`} style={labelStyle}>
        {question.text}
        {!question.required && (
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · optional</span>
        )}
        {}
        <span role="status" aria-live="polite" style={{ color: 'var(--cyan-700)', fontWeight: 400 }}>
          {saving ? ' · saving…' : ''}
        </span>
      </label>

      {question.helpText && (
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{question.helpText}</p>
      )}

      {question.type === 'text' && (
        <textarea
          id={id}
          rows={3}
          value={value as string}
          placeholder={question.placeholder ?? ''}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      )}

      {question.type === 'select' && (
        <select
          id={id}
          value={value as string}
          onChange={(e) => { setValue(e.target.value); commit(e.target.value); }}
          style={inputStyle}
        >
          <option value="">Choose one…</option>
          {question.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}

      {question.type === 'multiselect' && (
        <div id={id} role="group" aria-labelledby={`${id}-label`}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {question.options?.map((option) => {
            const selected = (value as string[]).includes(option);
            return (
              <label
                key={option}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  fontFamily: 'var(--font-ui)',
                  fontSize: 13.5,
                  padding: '7px 12px',
                  borderRadius: 'var(--radius-pill)',
                  border: `1.5px solid ${selected ? 'var(--cyan-500)' : 'var(--border-default)'}`,
                  background: selected ? 'var(--surface-accent-soft)' : 'transparent',
                  color: 'var(--text-primary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => {
                    const next = selected
                      ? (value as string[]).filter((v) => v !== option)
                      : [...(value as string[]), option];
                    setValue(next);
                    commit(next);
                  }}
                />
                {option}
              </label>
            );
          })}
        </div>
      )}

      {question.type === 'number' && (
        <>
          <input
            id={id}
            type="number"
            value={value as string}
            min={question.numeric?.min}
            max={question.numeric?.max}
            onChange={(e) => setValue(e.target.value)}
            onBlur={(e) => commit(Number(e.target.value))}
            style={inputStyle}
          />
          {question.numeric && (
            <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {question.numeric.unit} · between {question.numeric.min.toLocaleString()} and{' '}
              {question.numeric.max.toLocaleString()}
            </p>
          )}
        </>
      )}

      {question.type === 'range' && (() => {
        const r = isRange(value) ? value : { min: NaN, max: NaN };
        const set = (which: 'min' | 'max', raw: string) => {
          const next = { ...r, [which]: raw === '' ? NaN : Number(raw) };
          setValue(next);
          return next;
        };
        const send = (next: RangeValue) => { if (bothBoundsGiven(next)) commit(next); };
        const box = (which: 'min' | 'max', label: string, hint: string) => (
          <div style={{ flex: 1, minWidth: 0 }}>
            <label
              htmlFor={`${id}-${which}`}
              style={{
                display: 'block', fontSize: 12.5, fontWeight: 600,
                color: 'var(--text-secondary)', marginBottom: 5,
              }}
            >
              {label}
            </label>
            <input
              id={`${id}-${which}`}
              type="number"
              value={Number.isFinite(r[which]) ? String(r[which]) : ''}
              min={question.numeric?.min}
              max={question.numeric?.max}
              placeholder={hint}
              onChange={(e) => set(which, e.target.value)}
              onBlur={(e) => send(set(which, e.target.value))}
              style={inputStyle}
            />
          </div>
        );
        return (
          <div id={id} role="group" aria-labelledby={`${id}-label`}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              {box('min', 'Floor — below this you would stop', '2,000')}
              {box('max', 'Target — what you are aiming at', '8,000')}
            </div>
            {question.numeric && (
              <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {question.numeric.unit} · between {question.numeric.min.toLocaleString()} and{' '}
                {question.numeric.max.toLocaleString()}
              </p>
            )}
          </div>
        );
      })()}

      {error && (
        <p role="alert" style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--danger-text)' }}>{error}</p>
      )}
    </fieldset>
  );
}
