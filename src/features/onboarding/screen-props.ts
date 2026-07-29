import type { OnboardingActionName, OnboardingState } from '../../../shared/onboarding.ts';
import type { OnboardingUiState } from './onboarding-reducer.ts';

export interface OnboardingActionPayload {
  choiceId?: string;
  value?: string;
}

export interface ScreenProps {
  state: OnboardingState;
  ui: OnboardingUiState;
  onAction: (action: OnboardingActionName, payload?: OnboardingActionPayload) => void;
  onInspect: (choiceId: string | null) => void;
  reducedMotion: boolean;
  /** Update the in-memory editor draft. Never persisted anywhere. */
  onEditorDraftChange?: (draft: string) => void;
  /** Begin a chunked save of the current draft. */
  onEditorSave?: () => void;
  /** Abandon the draft without mutating the character. */
  onEditorCancel?: () => void;
}
