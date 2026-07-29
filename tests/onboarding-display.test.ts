import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHARACTER_CLASS_SUMMARY_LIMIT,
  truncateClassSummary,
} from '../src/features/onboarding/onboarding-display.ts';

test('short class summaries are left unchanged', () => {
  assert.equal(truncateClassSummary('Wizard/Cleric'), 'Wizard/Cleric');
  assert.equal(truncateClassSummary(undefined), undefined);
});

test('large staff class arrays are truncated to the safe card limit', () => {
  const summary = 'Wizard/Cleric/Rogue/Warrior/Monk/Druid/Berserker/Sorcerer/Paladin/Ranger/Bard';
  const truncated = truncateClassSummary(summary);

  assert.ok(truncated);
  assert.equal(truncated.length, CHARACTER_CLASS_SUMMARY_LIMIT);
  assert.ok(truncated.endsWith('...'));
});
