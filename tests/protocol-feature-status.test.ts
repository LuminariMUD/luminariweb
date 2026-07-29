import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROTOCOL_FEATURE_GROUPS,
  PROTOCOL_FEATURE_STATUS_LABELS,
  PROTOCOL_FEATURE_STATUSES,
  PROTOCOL_FOLLOW_UP_LABELS,
  REQUIRED_PROTOCOL_FEATURE_IDS,
  getProtocolFeaturesByGroup,
  getProtocolFeaturesByStatus,
  getProtocolStatusCounts,
  protocolFeatureRecords,
} from '../shared/protocol-feature-status.ts';
import type { ProtocolFeatureStatus } from '../shared/protocol-feature-status.ts';

test('covers every required protocol feature exactly once', () => {
  const featureIds = new Set(protocolFeatureRecords.map((feature) => feature.id));

  for (const requiredId of REQUIRED_PROTOCOL_FEATURE_IDS) {
    assert.ok(featureIds.has(requiredId), `missing required protocol feature: ${requiredId}`);
  }

  assert.equal(featureIds.size, protocolFeatureRecords.length, 'feature ids must be unique');
});

test('keeps protocol statuses exhaustive and counted deterministically', () => {
  const counts = getProtocolStatusCounts();
  const totalFromCounts = PROTOCOL_FEATURE_STATUSES.reduce(
    (total, status) => total + counts[status],
    0,
  );

  assert.equal(totalFromCounts, protocolFeatureRecords.length);
  assert.deepEqual(counts, {
    supported: 5,
    partial: 1,
    rejected: 3,
    deferred: 3,
    'validation-gap': 2,
  } satisfies Record<ProtocolFeatureStatus, number>);

  for (const status of PROTOCOL_FEATURE_STATUSES) {
    assert.ok(PROTOCOL_FEATURE_STATUS_LABELS[status], `missing label for ${status}`);
    assert.equal(getProtocolFeaturesByStatus(status).length, counts[status]);
  }
});

test('requires evidence and next actions for each protocol status record', () => {
  for (const feature of protocolFeatureRecords) {
    assert.ok(feature.name.trim(), `${feature.id} needs a name`);
    assert.ok(feature.summary.trim(), `${feature.id} needs a summary`);
    assert.ok(feature.detail.trim(), `${feature.id} needs detail`);
    assert.ok(feature.nextAction.trim(), `${feature.id} needs a next action`);
    assert.ok(feature.evidence.length > 0, `${feature.id} needs evidence`);

    for (const evidence of feature.evidence) {
      assert.ok(evidence.label.trim(), `${feature.id} has blank evidence label`);
      assert.ok(evidence.path.trim(), `${feature.id} has blank evidence path`);
    }
  }
});

test('groups features in catalog order without dropping records', () => {
  const grouped = getProtocolFeaturesByGroup();
  const groupedFeatureIds = grouped.flatMap(({ features }) =>
    features.map((feature) => feature.id),
  );
  const catalogFeatureIds = protocolFeatureRecords.map((feature) => feature.id);

  assert.deepEqual(
    grouped.map(({ group }) => group.id),
    PROTOCOL_FEATURE_GROUPS.map((group) => group.id),
  );
  for (const { group, features } of grouped) {
    assert.ok(features.every((feature) => feature.groupId === group.id));
  }
  assert.equal(new Set(groupedFeatureIds).size, protocolFeatureRecords.length);
  assert.deepEqual(groupedFeatureIds.toSorted(), catalogFeatureIds.toSorted());
});

test('keeps deferred and rejected protocol claims conservative', () => {
  const byId = new Map(protocolFeatureRecords.map((feature) => [feature.id, feature]));

  assert.notEqual(byId.get('mccp')?.status, 'supported');
  assert.equal(byId.get('mccp')?.status, 'rejected');
  assert.notEqual(byId.get('gmcp')?.status, 'supported');
  assert.equal(byId.get('gmcp')?.status, 'deferred');
  assert.ok(
    byId
      .get('mccp')
      ?.evidence.some(
        (evidence) => evidence.path === 'docs/adr/0002-mccp-and-gmcp-protocol-direction.md',
      ),
  );
  assert.ok(
    byId
      .get('gmcp')
      ?.evidence.some(
        (evidence) => evidence.path === 'docs/adr/0002-mccp-and-gmcp-protocol-direction.md',
      ),
  );
  assert.ok(!byId.get('mccp')?.nextAction.includes('Decide'));
  assert.ok(!byId.get('gmcp')?.nextAction.includes('Decide'));
  assert.equal(byId.get('mxp')?.status, 'rejected');
  assert.equal(byId.get('charset')?.status, 'rejected');
  assert.equal(byId.get('override-only-msdp-fields')?.status, 'validation-gap');
  assert.notEqual(byId.get('native-websocket')?.status, 'supported');
  assert.equal(byId.get('native-websocket')?.status, 'deferred');
  assert.ok(
    byId
      .get('native-websocket')
      ?.evidence.some(
        (evidence) => evidence.path === 'docs/adr/0003-native-websocket-transport-direction.md',
      ),
  );
  assert.ok(!byId.get('native-websocket')?.summary.includes('supported'));
  assert.ok(byId.get('native-websocket')?.nextAction.includes('dedicated future specs'));
});

test('links deferred source work to Phase 04 follow-up tags', () => {
  const sourceWork = protocolFeatureRecords.filter(
    (feature) =>
      feature.status === 'deferred' || feature.status === 'validation-gap' || feature.id === 'mccp',
  );

  for (const feature of sourceWork) {
    assert.ok(feature.followUpTags.length > 0, `${feature.id} needs Phase 04 tags`);
    for (const tag of feature.followUpTags) {
      assert.ok(PROTOCOL_FOLLOW_UP_LABELS[tag], `${feature.id} has unknown follow-up tag`);
    }
  }
});
