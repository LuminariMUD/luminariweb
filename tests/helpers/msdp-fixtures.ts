import { readFile } from 'node:fs/promises';
import type { MudValue } from '../../shared/mud.ts';

export type MsdpExpectedPair = readonly [variable: string, value: MudValue];
export type MsdpControlToken =
  | 'VAR'
  | 'VAL'
  | 'TABLE_OPEN'
  | 'TABLE_CLOSE'
  | 'ARRAY_OPEN'
  | 'ARRAY_CLOSE';
export type MsdpPayloadToken = MsdpControlToken | string;

export type MsdpFixture = {
  file: string;
  id: string;
  coverage: string[];
  expectedPairs: MsdpExpectedPair[];
  payloadTokens: MsdpPayloadToken[];
  sanitized: boolean;
};

export type MsdpFixtureCorpus = {
  manifest: MsdpFixtureManifest;
  fixtures: MsdpFixture[];
};

type MsdpFixtureManifest = {
  totals: {
    fixtureFiles: number;
    fixtures: number;
    realCaptureFixtures: number;
  };
  files: Array<{
    file: string;
    fixtureCount: number;
    fixtureIds: string[];
  }>;
};

type RawMsdpFixtureFile = {
  schemaVersion: number;
  fixtureFile: string;
  fixtures: unknown[];
};

const FIXTURE_ROOT_URL = new URL('../fixtures/msdp/', import.meta.url);

export async function loadMsdpFixtureCorpus(): Promise<MsdpFixtureCorpus> {
  const manifest = parseManifest(await readFixtureJson('manifest.json'), 'manifest.json');
  const fixtures: MsdpFixture[] = [];

  for (const entry of manifest.files) {
    const fixtureFile = parseFixtureFile(await readFixtureJson(entry.file), entry.file);

    if (fixtureFile.fixtures.length !== entry.fixtureCount) {
      throw new Error(`Fixture count mismatch in ${entry.file}`);
    }

    for (const fixture of fixtureFile.fixtures) {
      fixtures.push(parseFixture(entry.file, fixture));
    }
  }

  if (fixtures.length !== manifest.totals.fixtures) {
    throw new Error('Manifest fixture total does not match loaded fixtures');
  }

  return { manifest, fixtures };
}

export function getExpectedPairs(fixtures: MsdpFixture[]) {
  return fixtures.flatMap((fixture) =>
    fixture.expectedPairs.map((pair) => ({
      fixture,
      variable: pair[0],
      value: pair[1],
    })),
  );
}

async function readFixtureJson(file: string) {
  const url = new URL(file, FIXTURE_ROOT_URL);
  const text = await readFile(url, 'utf8');

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `Unable to parse ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function parseManifest(value: unknown, file: string): MsdpFixtureManifest {
  if (!isRecord(value) || !isRecord(value.totals) || !Array.isArray(value.files)) {
    throw new Error(`${file} is not a valid MSDP fixture manifest`);
  }

  const totals = {
    fixtureFiles: readNumber(value.totals.fixtureFiles, `${file}.totals.fixtureFiles`),
    fixtures: readNumber(value.totals.fixtures, `${file}.totals.fixtures`),
    realCaptureFixtures: readNumber(
      value.totals.realCaptureFixtures,
      `${file}.totals.realCaptureFixtures`,
    ),
  };
  const files = value.files.map((entry, index) =>
    parseManifestFile(entry, `${file}.files[${index}]`),
  );

  if (files.length !== totals.fixtureFiles) {
    throw new Error(`${file} fixture file total does not match manifest entries`);
  }

  return { totals, files };
}

function parseManifestFile(value: unknown, path: string): MsdpFixtureManifest['files'][number] {
  if (!isRecord(value) || !Array.isArray(value.fixtureIds)) {
    throw new Error(`${path} is not a valid fixture file entry`);
  }

  return {
    file: readString(value.file, `${path}.file`),
    fixtureCount: readNumber(value.fixtureCount, `${path}.fixtureCount`),
    fixtureIds: value.fixtureIds.map((id, index) => readString(id, `${path}.fixtureIds[${index}]`)),
  };
}

function parseFixtureFile(value: unknown, file: string): RawMsdpFixtureFile {
  if (!isRecord(value) || !Array.isArray(value.fixtures)) {
    throw new Error(`${file} is not a valid MSDP fixture file`);
  }

  return {
    schemaVersion: readNumber(value.schemaVersion, `${file}.schemaVersion`),
    fixtureFile: readString(value.fixtureFile, `${file}.fixtureFile`),
    fixtures: value.fixtures,
  };
}

function parseFixture(file: string, value: unknown): MsdpFixture {
  if (
    !isRecord(value) ||
    !isRecord(value.origin) ||
    !Array.isArray(value.coverage) ||
    !Array.isArray(value.expectedPairs)
  ) {
    throw new Error(`${file} contains an invalid fixture entry`);
  }

  const id = readString(value.id, `${file}.id`);
  const expectedPairs = value.expectedPairs.map((pair, index) =>
    parseExpectedPair(pair, `${file}.${id}.expectedPairs[${index}]`),
  );

  return {
    file,
    id,
    coverage: value.coverage.map((tag, index) =>
      readString(tag, `${file}.${id}.coverage[${index}]`),
    ),
    expectedPairs,
    payloadTokens: readPayloadTokens(value.payloadTokens, `${file}.${id}.payloadTokens`),
    sanitized: readBoolean(value.origin.sanitized, `${file}.${id}.origin.sanitized`),
  };
}

function readPayloadTokens(value: unknown, path: string): MsdpPayloadToken[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }

  return value.map((token, index) => readString(token, `${path}[${index}]`));
}

function parseExpectedPair(value: unknown, path: string): MsdpExpectedPair {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${path} is not a [variable, value] tuple`);
  }

  const variable = readString(value[0], `${path}[0]`);
  const pairValue = value[1];

  if (!isMudValue(pairValue)) {
    throw new Error(`${path}[1] is not a supported MudValue`);
  }

  return [variable, pairValue];
}

function isMudValue(value: unknown): value is MudValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isMudValue);
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(isMudValue);
}

function readString(value: unknown, path: string) {
  if (typeof value !== 'string') {
    throw new Error(`${path} must be a string`);
  }

  return value;
}

function readNumber(value: unknown, path: string) {
  if (typeof value !== 'number') {
    throw new Error(`${path} must be a number`);
  }

  return value;
}

function readBoolean(value: unknown, path: string) {
  if (typeof value !== 'boolean') {
    throw new Error(`${path} must be a boolean`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
