import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OnboardingActionName } from '../../../shared/onboarding.ts';
import { AccountLobbyScreen } from './AccountLobbyScreen.tsx';
import { AccountLoginScreen } from './AccountLoginScreen.tsx';
import { AlignmentScreen } from './AlignmentScreen.tsx';
import { BuildChoiceScreen } from './BuildChoiceScreen.tsx';
import { CharacterMenuScreen } from './CharacterMenuScreen.tsx';
import { CharacterNameScreen } from './CharacterNameScreen.tsx';
import { ChoiceConfirmScreen } from './ChoiceConfirmScreen.tsx';
import { ClassGallery } from './ClassGallery.tsx';
import { CreationSummary } from './CreationSummary.tsx';
import { HandoffScreen } from './HandoffScreen.tsx';
import { PreferencesScreen } from './PreferencesScreen.tsx';
import { RaceGallery } from './RaceGallery.tsx';
import { RoleplayCatalog } from './RoleplayCatalog.tsx';
import { RoleplayChoiceDetail } from './RoleplayChoiceDetail.tsx';
import { RoleplayDecisionScreen } from './RoleplayDecisionScreen.tsx';
import { RoleplayIdeaScreen } from './RoleplayIdeaScreen.tsx';
import { RoleplayProfileHub } from './RoleplayProfileHub.tsx';
import { RoleplayTextEditor } from './RoleplayTextEditor.tsx';
import { ShortDescriptionFlow } from './ShortDescriptionFlow.tsx';
import { SceneBackdrop } from './SceneBackdrop.tsx';
import { SexScreen } from './SexScreen.tsx';
import { screenSceneKeys } from './media-manifest.ts';
import {
  OnboardingAudio,
  loadAudioPreferences,
  persistenceCues,
  saveAudioPreferences,
  sceneAmbienceCues,
  sceneMusicCues,
  screenEnterCues,
  type AudioPreferences,
} from './onboarding-audio.ts';
import { activeCreationStep, creationSteps, type OnboardingUiState } from './onboarding-reducer.ts';
import type { OnboardingActionPayload, ScreenProps } from './screen-props.ts';
import './onboarding.css';

interface OnboardingShellProps {
  ui: OnboardingUiState;
  onAction: (action: OnboardingActionName, payload?: OnboardingActionPayload) => void;
  onInspect: (choiceId: string | null) => void;
  onUseClassicTerminal: () => void;
  /** Protocol v2 editor plumbing. Absent on a v1-only session. */
  onEditorDraftChange?: (draft: string) => void;
  onEditorSave?: () => void;
  onEditorCancel?: () => void;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return reduced;
}

/** Screens whose own component already renders confirm and reselect. */
const SCREENS_WITH_OWN_CONFIRM = new Set([
  'account-name-confirm',
  'name-confirm',
  'race-detail',
  'class-detail',
  'motd',
  'handoff',
]);

function renderScreen(props: ScreenProps) {
  switch (props.state.screen) {
    case 'account-name':
    case 'account-name-confirm':
    case 'account-password':
    case 'account-new-password':
    case 'account-confirm-password':
    case 'account-link':
    case 'account-link-password':
      return <AccountLoginScreen {...props} />;
    case 'account-menu':
      return <AccountLobbyScreen {...props} />;
    case 'character-menu':
      return <CharacterMenuScreen {...props} />;
    case 'name':
    case 'name-confirm':
      return <CharacterNameScreen {...props} />;
    case 'sex':
      return <SexScreen {...props} />;
    case 'race':
      return <RaceGallery {...props} />;
    case 'class':
      return <ClassGallery {...props} />;
    case 'race-detail':
    case 'class-detail':
      return <ChoiceConfirmScreen {...props} />;
    case 'build':
      return <BuildChoiceScreen {...props} />;
    case 'alignment':
      return <AlignmentScreen {...props} />;
    case 'preferences':
      return <PreferencesScreen {...props} />;
    case 'roleplay-decision':
      return <RoleplayDecisionScreen {...props} />;
    case 'motd':
    case 'handoff':
      return <HandoffScreen {...props} />;

    // --- protocol v2: role-play identity suite -----------------------------
    case 'roleplay-hub':
      return <RoleplayProfileHub {...props} />;
    case 'short-desc-intro':
    case 'short-desc-feature-1':
    case 'short-desc-adjective-1':
    case 'short-desc-preview':
    case 'short-desc-review':
    case 'short-desc-feature-2':
    case 'short-desc-adjective-2':
      return <ShortDescriptionFlow {...props} />;
    case 'long-description':
    case 'background-story':
    case 'goals-editor':
    case 'personality-editor':
    case 'ideals-editor':
    case 'bonds-editor':
    case 'flaws-editor':
      return <RoleplayTextEditor {...props} />;
    case 'goals-ideas':
    case 'personality-ideas':
    case 'ideals-ideas':
    case 'bonds-ideas':
    case 'flaws-ideas':
      return <RoleplayIdeaScreen {...props} />;
    case 'background-catalog':
    case 'age-select':
    case 'region-catalog':
    case 'faction-select':
    case 'hometown-select':
    case 'deity-select':
      return <RoleplayCatalog {...props} />;
    case 'background-confirm':
    case 'region-confirm':
    case 'deity-confirm':
      return <RoleplayChoiceDetail {...props} />;
    default:
      return null;
  }
}

/**
 * The cinematic onboarding surface.
 *
 * It is progressive enhancement over the classic terminal: the terminal is
 * never discarded, the "use the classic terminal" action is always reachable,
 * and every server message still arrives there for troubleshooting.
 */
export function OnboardingShell({
  ui,
  onAction,
  onInspect,
  onUseClassicTerminal,
  onEditorDraftChange,
  onEditorSave,
  onEditorCancel,
}: OnboardingShellProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [audio] = useState(() => new OnboardingAudio());
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const lastRevisionRef = useRef<string>('');
  const [audioPreferences, setAudioPreferences] = useState<AudioPreferences>(() =>
    loadAudioPreferences(),
  );
  const [audioPanelOpen, setAudioPanelOpen] = useState(false);

  const state = ui.state;
  const sceneKey = state
    ? (state.sceneKey ?? screenSceneKeys[state.screen] ?? 'scene/arrival')
    : 'scene/arrival';

  useEffect(() => {
    audio.setPreferences(audioPreferences);
    saveAudioPreferences(audioPreferences);
  }, [audio, audioPreferences]);

  // Expensive motion and audio both stop when the tab is not visible.
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const handleVisibility = () => audio.setHidden(document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [audio]);

  useEffect(() => {
    return () => audio.stopAll();
  }, [audio]);

  useEffect(() => {
    if (!audioPreferences.enabled) {
      return;
    }
    audio.setLoop('music', sceneMusicCues[sceneKey] ?? null);
    audio.setLoop('ambience', sceneAmbienceCues[sceneKey] ?? null);
  }, [audio, audioPreferences.enabled, sceneKey]);

  // Announce and focus each new server screen exactly once.
  useEffect(() => {
    if (!state) {
      return;
    }
    const key = `${state.flowId}:${state.revision}`;
    if (lastRevisionRef.current === key) {
      return;
    }
    lastRevisionRef.current = key;
    // Text-entry screens focus their field instead. Focusing this heading in
    // the parent effect would otherwise steal focus from the child form.
    if (state.inputKind !== 'text' && state.inputKind !== 'password') {
      headingRef.current?.focus();
    }

    const cue = state.error
      ? 'sfx/input-invalid'
      : (persistenceCues[state.persistence] ?? screenEnterCues[state.screen]);
    if (cue) {
      audio.play(cue);
    }
  }, [audio, state]);

  const handleAction = useCallback(
    (action: OnboardingActionName, payload?: OnboardingActionPayload) => {
      if (action === 'classic-terminal') {
        onUseClassicTerminal();
        return;
      }
      audio.play(action === 'select' ? 'sfx/card-select' : 'sfx/button-primary');
      onAction(action, payload);
    },
    [audio, onAction, onUseClassicTerminal],
  );

  const screenProps = useMemo<ScreenProps | null>(
    () =>
      state
        ? {
            state,
            ui,
            onAction: handleAction,
            onInspect,
            reducedMotion,
            onEditorDraftChange,
            onEditorSave,
            onEditorCancel,
          }
        : null,
    [
      handleAction,
      onEditorCancel,
      onEditorDraftChange,
      onEditorSave,
      onInspect,
      reducedMotion,
      state,
      ui,
    ],
  );

  if (!state || !screenProps) {
    return null;
  }

  const stepId = activeCreationStep(state.screen);
  const showProgress = state.mode === 'character-creation' && stepId !== null;
  const announcement = state.error ? `${state.error.message}` : `${state.title}. ${state.prompt}`;

  return (
    <section
      className={`onboarding${reducedMotion ? ' is-reduced-motion' : ''}`}
      data-screen={state.screen}
      data-mode={state.mode}
      aria-label="Luminari account and character creation"
    >
      <SceneBackdrop
        sceneKey={sceneKey}
        transitionKey={state.screen}
        reducedMotion={reducedMotion}
      />

      <div className="onboarding__chrome">
        <div className="onboarding__brand">
          <span className="onboarding__brand-mark" aria-hidden="true" />
          <span className="onboarding__brand-name">Luminari</span>
        </div>

        <div className="onboarding__chrome-actions">
          <button
            type="button"
            className="onboarding-button onboarding-button--quiet"
            aria-expanded={audioPanelOpen}
            onClick={() => setAudioPanelOpen((open) => !open)}
          >
            {audioPreferences.enabled ? 'Sound on' : 'Sound off'}
          </button>
          <button
            type="button"
            className="onboarding-button onboarding-button--quiet"
            onClick={onUseClassicTerminal}
          >
            Use the classic terminal
          </button>
        </div>

        {audioPanelOpen ? (
          <div className="onboarding__audio-panel" role="group" aria-label="Sound settings">
            <label className="onboarding__audio-row">
              <input
                type="checkbox"
                checked={audioPreferences.enabled}
                onChange={(event) =>
                  setAudioPreferences((current) => ({
                    ...current,
                    enabled: event.target.checked,
                  }))
                }
              />
              Enable sound
            </label>
            {(['music', 'ambience', 'sfx'] as const).map((channel) => (
              <label key={channel} className="onboarding__audio-row">
                <span>{channel === 'sfx' ? 'Interface sounds' : channel}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(audioPreferences.volumes[channel] * 100)}
                  disabled={!audioPreferences.enabled}
                  onChange={(event) =>
                    setAudioPreferences((current) => ({
                      ...current,
                      volumes: {
                        ...current.volumes,
                        [channel]: Number(event.target.value) / 100,
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>
        ) : null}
      </div>

      {showProgress ? (
        <ol className="onboarding__progress" aria-label="Character creation progress">
          {creationSteps.map((step) => {
            const isCurrent = step.id === stepId;
            return (
              <li
                key={step.id}
                className={`onboarding__progress-step${isCurrent ? ' is-current' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span className="onboarding__progress-dot" aria-hidden="true" />
                {step.label}
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="onboarding__stage">
        <main className="onboarding__main">
          <header className="onboarding__header">
            <h1 className="onboarding__title" tabIndex={-1} ref={headingRef}>
              {state.title}
            </h1>
            <p className="onboarding__prompt">{state.prompt}</p>
          </header>

          {state.error ? (
            <p className="onboarding__error" role="alert">
              {state.error.message}
            </p>
          ) : null}

          {ui.rejection ? (
            <p className="onboarding__error" role="alert">
              {ui.rejection.detail}
            </p>
          ) : null}

          <div className="onboarding__screen" key={`${state.flowId}-${state.screen}`}>
            {renderScreen(screenProps)}
          </div>

          {/* Safety net: a screen that offers confirm or reselect must always
              show them. Without this a server state whose own component has
              nothing to render becomes a dead end with no way forward. */}
          {!SCREENS_WITH_OWN_CONFIRM.has(state.screen) &&
          (state.actions.includes('confirm') || state.actions.includes('reselect')) ? (
            <div className="onboarding-actions onboarding-actions--secondary">
              {state.actions.includes('confirm') ? (
                <button
                  type="button"
                  className="onboarding-button onboarding-button--primary"
                  disabled={ui.pending}
                  onClick={() => handleAction('confirm')}
                >
                  Continue
                </button>
              ) : null}
              {state.actions.includes('reselect') ? (
                <button
                  type="button"
                  className="onboarding-button"
                  disabled={ui.pending}
                  onClick={() => handleAction('reselect')}
                >
                  Go back to the previous choice
                </button>
              ) : null}
            </div>
          ) : null}
        </main>

        <CreationSummary state={state} />
      </div>

      <p className="onboarding-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
