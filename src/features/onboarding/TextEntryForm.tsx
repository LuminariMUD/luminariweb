import { useCallback, useEffect, useRef, useState } from 'react';
import { onboardingLimits } from '../../../shared/onboarding.ts';
import type { ScreenProps } from './screen-props.ts';

interface TextEntryFormProps extends Pick<ScreenProps, 'state' | 'ui' | 'onAction'> {
  submitLabel?: string;
  inputLabel?: string;
}

/**
 * The only text entry point in the structured flow.
 *
 * Sensitive values are masked, cleared the moment they are sent, excluded from
 * autofill and form history, and never routed through the ordinary command path
 * with its history, aliases, and triggers. Nothing typed here is persisted,
 * exported, cached, or logged.
 */
export function TextEntryForm({
  state,
  ui,
  onAction,
  submitLabel,
  inputLabel,
}: TextEntryFormProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sensitive = ui.sensitive || state.sensitiveInput || state.inputKind === 'password';
  const screenKey = `${state.flowId}:${state.revision}`;
  const [lastScreenKey, setLastScreenKey] = useState(screenKey);

  // Any new server screen starts from an empty field, so a value can never
  // leak from one prompt into the next. Resetting during render (rather than
  // in an effect) means the stale value is never committed to the DOM.
  if (lastScreenKey !== screenKey) {
    setLastScreenKey(screenKey);
    setValue('');
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, [screenKey]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = value.trim();
      if (!trimmed || ui.pending) {
        return;
      }

      onAction('submit', { value: trimmed });
      setValue('');
    },
    [onAction, ui.pending, value],
  );

  const inputId = `onboarding-input-${state.screen}`;
  const errorId = state.error ? `${inputId}-error` : undefined;

  return (
    <form className="onboarding-form" onSubmit={handleSubmit} autoComplete="off" noValidate>
      <label className="onboarding-form__label" htmlFor={inputId}>
        {inputLabel ?? state.inputLabel ?? (sensitive ? 'Password' : 'Enter a value')}
      </label>
      <div className="onboarding-form__row">
        <input
          id={inputId}
          ref={inputRef}
          className="onboarding-form__input"
          type={sensitive ? 'password' : 'text'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={onboardingLimits.maxShortText}
          disabled={ui.pending}
          aria-describedby={errorId}
          aria-invalid={state.error ? true : undefined}
          autoFocus
          autoComplete={sensitive ? 'new-password' : 'off'}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-lpignore="true"
          name={sensitive ? 'luminari-sensitive' : 'luminari-entry'}
        />
        <button
          type="submit"
          className="onboarding-button onboarding-button--primary"
          disabled={ui.pending || !value.trim()}
        >
          {submitLabel ?? 'Continue'}
        </button>
      </div>
      {sensitive ? (
        <p className="onboarding-form__hint">
          This value is hidden and is never stored, exported, or added to your command history.
        </p>
      ) : null}
    </form>
  );
}
