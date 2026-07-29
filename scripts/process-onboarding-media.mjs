#!/usr/bin/env node
/**
 * Onboarding media pipeline.
 *
 * Reads unprocessed production packages from `assets-unprocessed/` and emits
 * versioned, responsive web derivatives into
 * `public/media/onboarding/v1/<category>/<name>/...` plus a generated manifest
 * consumed by `src/features/onboarding/media-manifest.ts`.
 *
 * The pipeline is idempotent: an output is regenerated only when its source is
 * newer, so it is cheap to re-run while art is still being produced.
 *
 * Usage:
 *   node scripts/process-onboarding-media.mjs [--force] [--only <key-prefix>]
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repoRoot, 'assets-unprocessed');
const mediaVersion = 'v1';
const outputRoot = path.join(repoRoot, 'public', 'media', 'onboarding', mediaVersion);
const manifestPath = path.join(
  repoRoot,
  'src',
  'features',
  'onboarding',
  'generated-media-manifest.json',
);
const metadataPath = path.join(repoRoot, 'scripts', 'onboarding-media-metadata.json');

const publicPrefix = `/media/onboarding/${mediaVersion}`;

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyIndex = args.indexOf('--only');
const onlyPrefix = onlyIndex >= 0 ? args[onlyIndex + 1] : null;

/** Raster categories and the derivative recipe used for each. */
const imageProfiles = {
  scene: {
    kind: 'scene',
    renditions: [
      { name: 'desktop', aspect: [16, 9], widths: [1280, 1920, 2560] },
      { name: 'tablet', aspect: [4, 5], widths: [768, 1280] },
      { name: 'mobile', aspect: [3, 4], widths: [480, 768] },
    ],
    poster: { rendition: 'desktop', width: 1920 },
  },
  race: {
    kind: 'keyart',
    renditions: [
      { name: 'detail', aspect: [4, 5], widths: [720, 1200] },
      { name: 'wide', aspect: [16, 9], widths: [1280] },
      { name: 'thumb', aspect: [4, 5], widths: [400] },
      { name: 'square', aspect: [1, 1], widths: [512] },
    ],
    poster: { rendition: 'detail', width: 1200 },
  },
  class: { alias: 'race' },
  region: {
    kind: 'location',
    renditions: [
      { name: 'landscape', aspect: [16, 9], widths: [768, 1280, 1920] },
      { name: 'mobile', aspect: [3, 4], widths: [480, 768] },
      { name: 'thumb', aspect: [16, 9], widths: [400] },
    ],
    poster: { rendition: 'landscape', width: 1280 },
  },
  hometown: { alias: 'region' },
  alignment: {
    kind: 'vignette',
    renditions: [
      { name: 'detail', aspect: [4, 5], widths: [512, 1024] },
      { name: 'thumb', aspect: [1, 1], widths: [256] },
      { name: 'square', aspect: [1, 1], widths: [512] },
    ],
    poster: { rendition: 'detail', width: 512 },
  },
  vignette: {
    kind: 'vignette',
    renditions: [
      { name: 'detail', aspect: [4, 5], widths: [512, 1024] },
      { name: 'thumb', aspect: [1, 1], widths: [256] },
    ],
    poster: { rendition: 'detail', width: 512 },
  },
};

/** Categories that fall back to the small `vignette` recipe. */
const vignetteCategories = [
  'account',
  'age',
  'background',
  'brand',
  'build',
  'deity',
  'faction',
  'identity',
  'preferences',
  'roleplay',
  'shared',
  'state',
];

const audioCategories = ['sfx', 'music', 'ambience'];

/** Transparent still layers that compose a scene pack. */
const layerNames = ['far', 'mid', 'fore', 'overlay'];

function resolveProfile(category) {
  let profile = imageProfiles[category];
  while (profile && profile.alias) {
    profile = imageProfiles[profile.alias];
  }
  if (profile) {
    return profile;
  }
  if (vignetteCategories.includes(category)) {
    return imageProfiles.vignette;
  }
  return null;
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
  if (result.error) {
    throw new Error(`${command} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${commandArgs.join(' ')} exited ${result.status}: ${result.stderr?.trim()}`,
    );
  }
  return result.stdout;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isStale(sourceFile, outputFile) {
  if (force || !fs.existsSync(outputFile)) {
    return true;
  }
  return fs.statSync(sourceFile).mtimeMs > fs.statSync(outputFile).mtimeMs;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

function identify(file) {
  const out = run('identify', ['-format', '%w %h %[channels]', `${file}[0]`])
    .trim()
    .split(/\s+/);
  return { width: Number(out[0]), height: Number(out[1]), channels: out[2] ?? '' };
}

function hasAlpha(file) {
  const info = identify(file);
  return /a$/i.test(info.channels) || /matte/i.test(info.channels);
}

/**
 * Crop-to-fill a source image to an exact aspect ratio and width, then encode
 * AVIF and WebP (plus PNG when the source carries transparency).
 */
function renderRendition(sourceFile, targetDir, baseName, aspect, width, alpha) {
  const height = Math.round((width * aspect[1]) / aspect[0]);
  const geometry = `${width}x${height}`;
  const outputs = [];
  const formats = alpha ? ['avif', 'webp', 'png'] : ['avif', 'webp'];

  for (const format of formats) {
    const outputFile = path.join(targetDir, `${baseName}-${width}.${format}`);
    if (isStale(sourceFile, outputFile)) {
      const encode = [];
      if (format === 'avif') {
        encode.push('-quality', '58');
      } else if (format === 'webp') {
        encode.push('-quality', '78', '-define', 'webp:method=6');
      } else {
        encode.push('-define', 'png:compression-level=9', '-strip');
      }
      run('convert', [
        `${sourceFile}[0]`,
        '-auto-orient',
        '-colorspace',
        'sRGB',
        '-resize',
        `${geometry}^`,
        '-gravity',
        'center',
        '-extent',
        geometry,
        ...encode,
        outputFile,
      ]);
    }
    outputs.push({
      format,
      width,
      height,
      src: toPublicUrl(outputFile),
      bytes: fs.statSync(outputFile).size,
    });
  }

  return { width, height, outputs };
}

function toPublicUrl(file) {
  return `${publicPrefix}/${path.relative(outputRoot, file).split(path.sep).join('/')}`;
}

/** Tiny inline placeholder shown before the real art decodes. */
function buildPlaceholder(sourceFile, aspect) {
  const height = Math.max(1, Math.round((24 * aspect[1]) / aspect[0]));
  const tmp = path.join(
    fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'lum-media-')),
    'placeholder.webp',
  );
  run('convert', [
    `${sourceFile}[0]`,
    '-auto-orient',
    '-colorspace',
    'sRGB',
    '-resize',
    `24x${height}^`,
    '-gravity',
    'center',
    '-extent',
    `24x${height}`,
    '-blur',
    '0x1',
    '-quality',
    '40',
    tmp,
  ]);
  const data = fs.readFileSync(tmp).toString('base64');
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  return `data:image/webp;base64,${data}`;
}

function dominantColor(sourceFile) {
  const out = run('convert', [
    `${sourceFile}[0]`,
    '-colorspace',
    'sRGB',
    '-resize',
    '1x1!',
    '-format',
    '%[hex:p{0,0}]',
    'info:',
  ]).trim();
  const hex = out.slice(0, 6);
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : '#101418';
}

function readMetadata() {
  if (!fs.existsSync(metadataPath)) {
    return { assets: {} };
  }
  return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
}

/**
 * Discover source files. Supports both flat `category-name[-layer].ext` files
 * and nested `category/name[-layer].ext` directories.
 */
function discoverSources() {
  const found = new Map();
  const knownCategories = new Set([
    ...Object.keys(imageProfiles).filter((key) => key !== 'vignette'),
    ...vignetteCategories,
  ]);

  const walk = (dir, nestedCategory) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.endsWith('-sfx-v1') || entry.name.startsWith('web-onboarding-')) {
          continue;
        }
        walk(full, knownCategories.has(entry.name) ? entry.name : nestedCategory);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.svg'].includes(extension)) {
        continue;
      }

      const stem = path.basename(entry.name, extension);
      let category = nestedCategory;
      let remainder = stem;
      if (!category) {
        const separator = stem.indexOf('-');
        if (separator < 0) {
          continue;
        }
        category = stem.slice(0, separator);
        remainder = stem.slice(separator + 1);
      }
      if (!knownCategories.has(category)) {
        continue;
      }

      let layer = null;
      for (const candidate of layerNames) {
        if (remainder.endsWith(`-${candidate}`)) {
          layer = candidate;
          remainder = remainder.slice(0, -(candidate.length + 1));
          break;
        }
      }
      if (!remainder) {
        continue;
      }

      const key = `${category}/${remainder}`;
      if (!found.has(key)) {
        found.set(key, { key, category, name: remainder, master: null, layers: {}, svg: null });
      }
      const record = found.get(key);
      if (extension === '.svg') {
        record.svg = full;
      } else if (layer) {
        record.layers[layer] = full;
      } else {
        record.master = full;
      }
    }
  };

  if (fs.existsSync(sourceRoot)) {
    walk(sourceRoot, null);
  }
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Transparent motion layers must keep their native aspect ratio: cropping a
 * particle sheet or an ink bloom to a card ratio would destroy it.
 */
const transparentLayerNames = new Set([
  'motes-dust',
  'motes-arcane',
  'embers',
  'stars',
  'fog-far',
  'fog-near',
  'light-rays',
  'ink-bloom',
]);

function processTransparentLayer(record, metadata) {
  const source = record.master ?? Object.values(record.layers)[0];
  if (!source) {
    return null;
  }

  const targetDir = path.join(outputRoot, record.category, record.name);
  ensureDir(targetDir);

  const info = identify(source);
  const width = Math.min(info.width, 2048);
  const height = Math.max(1, Math.round((width / info.width) * info.height));
  const sources = [];

  for (const format of ['webp', 'png']) {
    const outputFile = path.join(targetDir, `layer.${format}`);
    if (isStale(source, outputFile)) {
      run('convert', [
        `${source}[0]`,
        '-colorspace',
        'sRGB',
        '-resize',
        `${width}x${height}`,
        ...(format === 'webp'
          ? ['-quality', '84']
          : ['-define', 'png:compression-level=9', '-strip']),
        outputFile,
      ]);
    }
    sources.push({
      format,
      width,
      height,
      src: toPublicUrl(outputFile),
      bytes: fs.statSync(outputFile).size,
    });
  }

  const meta = metadata.assets?.[record.key];
  return {
    key: record.key,
    category: record.category,
    type: 'layer',
    version: mediaVersion,
    alt: '',
    decorative: true,
    sprites: [{ id: 'layer', width, height, sources }],
    checksum: sha256(source),
    provenance: meta?.provenance ?? null,
  };
}

function processImageAsset(record, metadata) {
  if (record.category === 'shared' && transparentLayerNames.has(record.name)) {
    return processTransparentLayer(record, metadata);
  }

  const profile = resolveProfile(record.category);
  if (!profile) {
    return null;
  }

  const targetDir = path.join(outputRoot, record.category, record.name);
  ensureDir(targetDir);

  const entry = {
    key: record.key,
    category: record.category,
    type: 'image',
    version: mediaVersion,
    renditions: {},
    layers: {},
  };

  const master = record.master ?? Object.values(record.layers)[0] ?? null;

  if (master) {
    const alpha = hasAlpha(master);
    const sourceInfo = identify(master);
    entry.sourceWidth = sourceInfo.width;
    entry.sourceHeight = sourceInfo.height;
    entry.checksum = sha256(master);

    for (const rendition of profile.renditions) {
      const built = [];
      for (const width of rendition.widths) {
        if (width > sourceInfo.width * 2) {
          continue;
        }
        built.push(
          renderRendition(master, targetDir, rendition.name, rendition.aspect, width, alpha),
        );
      }
      if (!built.length) {
        // Source is smaller than every requested width; still emit the smallest.
        const smallest = Math.min(...rendition.widths);
        built.push(
          renderRendition(master, targetDir, rendition.name, rendition.aspect, smallest, alpha),
        );
      }
      entry.renditions[rendition.name] = {
        aspectRatio: rendition.aspect[0] / rendition.aspect[1],
        sources: built.flatMap((item) => item.outputs),
      };
    }

    const posterRendition = profile.renditions.find(
      (item) => item.name === profile.poster.rendition,
    );
    entry.placeholder = buildPlaceholder(master, posterRendition.aspect);
    entry.dominantColor = dominantColor(master);
    entry.poster = {
      rendition: profile.poster.rendition,
      width: profile.poster.width,
    };
  }

  for (const [layerName, layerFile] of Object.entries(record.layers)) {
    const alpha = hasAlpha(layerFile);
    const sourceInfo = identify(layerFile);
    const rendition = profile.renditions[0];
    const built = rendition.widths
      .filter((width) => width <= sourceInfo.width * 2)
      .map((width) =>
        renderRendition(layerFile, targetDir, `layer-${layerName}`, rendition.aspect, width, alpha),
      );
    entry.layers[layerName] = {
      aspectRatio: rendition.aspect[0] / rendition.aspect[1],
      sources: built.flatMap((item) => item.outputs),
    };
  }

  if (record.svg) {
    const outputFile = path.join(targetDir, 'emblem.svg');
    if (isStale(record.svg, outputFile)) {
      fs.copyFileSync(record.svg, outputFile);
    }
    entry.emblem = { src: toPublicUrl(outputFile), bytes: fs.statSync(outputFile).size };
  }

  const meta = metadata.assets?.[record.key];
  entry.alt = meta?.alt ?? '';
  entry.decorative = meta?.decorative === true;
  entry.accent = meta?.accent ?? entry.dominantColor ?? '#101418';
  entry.preload = meta?.preload ?? 'lazy';
  entry.provenance = meta?.provenance ?? null;
  if (!entry.alt && !entry.decorative) {
    entry.altPending = true;
  }

  return entry;
}

/** Per-category transfer budgets from the media manifest, in bytes. */
const audioBudgets = {
  sfx: 100 * 1024,
  ambience: 900 * 1024,
  music: 2500 * 1024,
};

const MIN_OPUS_BITRATE = 40_000;

function audioDurationSeconds(file) {
  const out = run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    file,
  ]).trim();
  const duration = Number(out);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

/**
 * Publish the supplied Opus encode when it already fits the category budget.
 * When it does not, re-encode from the lossless master at a bitrate computed
 * from the cue's own duration, so a long ambience loop is not silently shipped
 * over budget.
 */
function deliverAudioWithinBudget(opusSource, opusTarget, category, cueDir, name) {
  const budget = audioBudgets[category];
  const sourceBytes = fs.statSync(opusSource).size;

  if (!budget || sourceBytes <= budget) {
    fs.copyFileSync(opusSource, opusTarget);
    return;
  }

  const master = ['master.wav', 'selected-source.wav']
    .map((suffix) => path.join(cueDir, `${name}.${suffix}`))
    .find((candidate) => fs.existsSync(candidate));
  const encodeSource = master ?? opusSource;
  const duration = audioDurationSeconds(encodeSource);

  if (!duration) {
    fs.copyFileSync(opusSource, opusTarget);
    process.stdout.write(
      `Warning: ${category}/${name} is over budget and has no readable master\n`,
    );
    return;
  }

  // Opus VBR overshoots a nominal bitrate, so converge by measurement rather
  // than trusting the first estimate.
  let targetBitrate = Math.max(
    MIN_OPUS_BITRATE,
    Math.floor((budget * 0.9 * 8) / duration / 1000) * 1000,
  );
  let finalBytes = 0;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    run('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      encodeSource,
      '-c:a',
      'libopus',
      '-b:a',
      String(targetBitrate),
      '-vbr',
      'on',
      '-application',
      'audio',
      '-ar',
      '48000',
      opusTarget,
    ]);

    finalBytes = fs.statSync(opusTarget).size;
    if (finalBytes <= budget || targetBitrate <= MIN_OPUS_BITRATE) {
      break;
    }

    const scaled = Math.floor((targetBitrate * (budget * 0.95)) / finalBytes / 1000) * 1000;
    targetBitrate = Math.max(MIN_OPUS_BITRATE, scaled);
  }

  process.stdout.write(
    `Re-encoded ${category}/${name} to ${Math.round(targetBitrate / 1000)}kbps: ` +
      `${Math.round(sourceBytes / 1024)}KB -> ${Math.round(finalBytes / 1024)}KB (budget ${Math.round(
        budget / 1024,
      )}KB)\n`,
  );
}

/**
 * Music and ambience packages ship one directory per cue holding the web Opus
 * encode, a browser fallback, and the lossless master. Only the two web
 * encodes are published.
 */
function processCueDirectoryPackage(packageDir, metadata) {
  const entries = [];
  const provenanceFile = path.join(packageDir, 'provenance.json');
  const provenance = fs.existsSync(provenanceFile)
    ? JSON.parse(fs.readFileSync(provenanceFile, 'utf8'))
    : { assets: [] };
  const recordById = new Map((provenance.assets ?? []).map((asset) => [asset.id, asset]));

  for (const category of audioCategories) {
    const categoryDir = path.join(packageDir, category);
    if (!fs.existsSync(categoryDir) || !fs.statSync(categoryDir).isDirectory()) {
      continue;
    }

    for (const name of fs.readdirSync(categoryDir).sort()) {
      const cueDir = path.join(categoryDir, name);
      if (!fs.statSync(cueDir).isDirectory()) {
        continue;
      }

      const opusSource = path.join(cueDir, `${name}.web.opus.ogg`);
      if (!fs.existsSync(opusSource)) {
        continue;
      }

      const key = `${category}/${name}`;
      const targetDir = path.join(outputRoot, category);
      ensureDir(targetDir);

      const opusTarget = path.join(targetDir, `${name}.opus.ogg`);
      if (isStale(opusSource, opusTarget)) {
        deliverAudioWithinBudget(opusSource, opusTarget, category, cueDir, name);
      }

      const sources = [
        {
          format: 'opus',
          mimeType: 'audio/ogg; codecs=opus',
          src: toPublicUrl(opusTarget),
          bytes: fs.statSync(opusTarget).size,
        },
      ];

      const mp3Source = path.join(cueDir, `${name}.browser-fallback.mp3`);
      if (fs.existsSync(mp3Source)) {
        const mp3Target = path.join(targetDir, `${name}.mp3`);
        if (isStale(mp3Source, mp3Target)) {
          fs.copyFileSync(mp3Source, mp3Target);
        }
        sources.push({
          format: 'mp3',
          mimeType: 'audio/mpeg',
          src: toPublicUrl(mp3Target),
          bytes: fs.statSync(mp3Target).size,
        });
      }

      const record = recordById.get(key);
      const meta = metadata.assets?.[key];
      entries.push({
        key,
        category,
        type: 'audio',
        version: mediaVersion,
        title: record?.title ?? name,
        durationSeconds: record?.intendedDurationSeconds ?? null,
        loop: record?.seamlessLoop ?? true,
        sources,
        checksum: sha256(opusTarget),
        provenance: meta?.provenance ?? provenance.assetSetId ?? null,
      });
    }
  }

  return entries;
}

function processAudioPackage(metadata) {
  const entries = [];
  if (!fs.existsSync(sourceRoot)) {
    return entries;
  }

  const packages = fs
    .readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(sourceRoot, entry.name));

  for (const packageDir of packages) {
    const opusRoot = path.join(packageDir, 'web-opus');
    if (!fs.existsSync(opusRoot)) {
      entries.push(...processCueDirectoryPackage(packageDir, metadata));
      continue;
    }
    const catalogFile = path.join(packageDir, 'cue-catalog.json');
    const catalog = fs.existsSync(catalogFile)
      ? JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
      : { cues: [] };
    const cueById = new Map((catalog.cues ?? []).map((cue) => [cue.id, cue]));

    for (const category of fs.readdirSync(opusRoot)) {
      if (!audioCategories.includes(category)) {
        continue;
      }
      const categoryDir = path.join(opusRoot, category);
      if (!fs.statSync(categoryDir).isDirectory()) {
        continue;
      }

      for (const file of fs.readdirSync(categoryDir).sort()) {
        if (!file.endsWith('.ogg')) {
          continue;
        }
        const name = path.basename(file, '.ogg');
        const key = `${category}/${name}`;
        const targetDir = path.join(outputRoot, category);
        ensureDir(targetDir);

        const sources = [];
        const opusSource = path.join(categoryDir, file);
        const opusTarget = path.join(targetDir, `${name}.opus.ogg`);
        if (isStale(opusSource, opusTarget)) {
          fs.copyFileSync(opusSource, opusTarget);
        }
        sources.push({
          format: 'opus',
          mimeType: 'audio/ogg; codecs=opus',
          src: toPublicUrl(opusTarget),
          bytes: fs.statSync(opusTarget).size,
        });

        const mp3Source = path.join(packageDir, 'web-mp3', category, `${name}.mp3`);
        if (fs.existsSync(mp3Source)) {
          const mp3Target = path.join(targetDir, `${name}.mp3`);
          if (isStale(mp3Source, mp3Target)) {
            fs.copyFileSync(mp3Source, mp3Target);
          }
          sources.push({
            format: 'mp3',
            mimeType: 'audio/mpeg',
            src: toPublicUrl(mp3Target),
            bytes: fs.statSync(mp3Target).size,
          });
        }

        const cue = cueById.get(key);
        const meta = metadata.assets?.[key];
        entries.push({
          key,
          category,
          type: 'audio',
          version: mediaVersion,
          title: cue?.title ?? name,
          durationSeconds: cue?.durationSeconds ?? null,
          loop: cue?.loop ?? category !== 'sfx',
          sources,
          checksum: sha256(opusTarget),
          provenance: meta?.provenance ?? catalog.packageId ?? null,
        });
      }
    }
  }

  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Open/free source packages (textures, particle sprites, fog and ray layers,
 * and glyph sets) arrive as raw downloads with their own provenance records.
 * They become shared building blocks rather than catalog art.
 */
function processVisualDownloads(metadata) {
  const packageDir = path.join(sourceRoot, 'web-onboarding-visual-downloads-v1');
  if (!fs.existsSync(packageDir)) {
    return { assets: [], attribution: [] };
  }

  const assets = [];
  const attribution = [];
  const provenanceFile = path.join(packageDir, 'provenance.json');
  const provenance = fs.existsSync(provenanceFile)
    ? JSON.parse(fs.readFileSync(provenanceFile, 'utf8'))
    : { contract_keys: [] };
  const provenanceByKey = new Map(
    (provenance.contract_keys ?? []).map((entry) => [entry.key, entry]),
  );

  const recordAttribution = (key, record) => {
    if (!record) {
      return;
    }
    attribution.push({
      key,
      creator: record.creator ?? record.author ?? 'unknown',
      source: record.source_url ?? record.source ?? '',
      license: record.license ?? 'unknown',
    });
  };

  // --- Tiling surface textures -------------------------------------------
  const texturesDir = path.join(packageDir, 'textures');
  if (fs.existsSync(texturesDir)) {
    for (const name of fs.readdirSync(texturesDir).sort()) {
      const dir = path.join(texturesDir, name);
      if (!fs.statSync(dir).isDirectory()) {
        continue;
      }
      const colorMap = fs.readdirSync(dir).find((file) => /_color\.(jpg|jpeg|png)$/i.test(file));
      if (!colorMap) {
        continue;
      }

      const source = path.join(dir, colorMap);
      const key = `shared/${name}`;
      const targetDir = path.join(outputRoot, 'shared', name);
      ensureDir(targetDir);

      const sources = [];
      for (const size of [512, 1024]) {
        for (const format of ['avif', 'webp']) {
          const outputFile = path.join(targetDir, `tile-${size}.${format}`);
          if (isStale(source, outputFile)) {
            // Exact resize keeps the tile seamless; cropping would not.
            run('convert', [
              `${source}[0]`,
              '-colorspace',
              'sRGB',
              '-resize',
              `${size}x${size}!`,
              '-quality',
              format === 'avif' ? '52' : '74',
              outputFile,
            ]);
          }
          sources.push({
            format,
            width: size,
            height: size,
            src: toPublicUrl(outputFile),
            bytes: fs.statSync(outputFile).size,
          });
        }
      }

      const record = provenanceByKey.get(key);
      recordAttribution(key, record);
      assets.push({
        key,
        category: 'shared',
        type: 'texture',
        version: mediaVersion,
        tileable: true,
        alt: '',
        decorative: true,
        dominantColor: dominantColor(source),
        accent: metadata.assets?.[key]?.accent ?? dominantColor(source),
        sources,
        provenance: record ? `${record.creator} / ${record.license}` : null,
      });
    }
  }

  // --- Reusable motion layers and particle sprites ------------------------
  const motionDir = path.join(packageDir, 'motion');
  if (fs.existsSync(motionDir)) {
    for (const name of fs.readdirSync(motionDir).sort()) {
      const dir = path.join(motionDir, name);
      if (!fs.statSync(dir).isDirectory()) {
        continue;
      }
      const files = fs
        .readdirSync(dir)
        .filter((file) => /\.(png|webp)$/i.test(file))
        .sort();
      if (!files.length) {
        continue;
      }

      const key = `shared/${name}`;
      const targetDir = path.join(outputRoot, 'shared', name);
      ensureDir(targetDir);

      const isSpriteSet = files.length > 1;
      const sprites = [];
      for (const file of files) {
        const source = path.join(dir, file);
        const stem = path.basename(file, path.extname(file));
        const info = identify(source);
        const width = Math.min(info.width, isSpriteSet ? 256 : 2048);
        const height = Math.max(1, Math.round((width / info.width) * info.height));
        const spriteSources = [];

        for (const format of ['webp', 'png']) {
          const outputFile = path.join(targetDir, `${stem}.${format}`);
          if (isStale(source, outputFile)) {
            run('convert', [
              `${source}[0]`,
              '-colorspace',
              'sRGB',
              '-resize',
              `${width}x${height}`,
              ...(format === 'webp'
                ? ['-define', 'webp:lossless=false', '-quality', '82']
                : ['-define', 'png:compression-level=9', '-strip']),
              outputFile,
            ]);
          }
          spriteSources.push({
            format,
            width,
            height,
            src: toPublicUrl(outputFile),
            bytes: fs.statSync(outputFile).size,
          });
        }

        sprites.push({ id: stem, width, height, sources: spriteSources });
      }

      const record = provenanceByKey.get(key);
      recordAttribution(key, record);
      assets.push({
        key,
        category: 'shared',
        type: isSpriteSet ? 'sprite-set' : 'layer',
        version: mediaVersion,
        alt: '',
        decorative: true,
        sprites,
        // The light-ray source ships yellow; art direction recolors it in CSS.
        recolor: name === 'light-rays',
        provenance: record ? `${record.creator} / ${record.license}` : null,
      });
    }
  }

  // --- Functional glyph sets ---------------------------------------------
  const glyphDir = path.join(packageDir, 'glyphs');
  const glyphCatalogFile = path.join(packageDir, 'glyph-catalog.json');
  if (fs.existsSync(glyphDir)) {
    const glyphCatalog = fs.existsSync(glyphCatalogFile)
      ? JSON.parse(fs.readFileSync(glyphCatalogFile, 'utf8'))
      : { glyphs: [] };
    const glyphMeta = new Map(
      (glyphCatalog.glyphs ?? []).map((glyph) => [`${glyph.set}:${glyph.key}`, glyph]),
    );

    for (const setName of fs.readdirSync(glyphDir).sort()) {
      const dir = path.join(glyphDir, setName);
      if (!fs.statSync(dir).isDirectory()) {
        continue;
      }

      const key = `shared/${setName}`;
      const targetDir = path.join(outputRoot, 'shared', setName);
      ensureDir(targetDir);

      const glyphs = [];
      for (const file of fs.readdirSync(dir).sort()) {
        if (!file.endsWith('.svg')) {
          continue;
        }
        const source = path.join(dir, file);
        const outputFile = path.join(targetDir, file);
        if (isStale(source, outputFile)) {
          fs.copyFileSync(source, outputFile);
        }
        const glyphKey = path.basename(file, '.svg');
        const meta = glyphMeta.get(`${key}:${glyphKey}`);
        glyphs.push({
          id: glyphKey,
          src: toPublicUrl(outputFile),
          bytes: fs.statSync(outputFile).size,
          author: meta?.author ?? null,
        });
        if (meta) {
          attribution.push({
            key: `${key}/${glyphKey}`,
            creator: meta.author ?? 'unknown',
            source: meta.source_url ?? glyphCatalog.source ?? '',
            license: glyphCatalog.license ?? 'unknown',
          });
        }
      }

      assets.push({
        key,
        category: 'shared',
        type: 'glyph-set',
        version: mediaVersion,
        // A glyph never carries meaning on its own; the UI always labels it.
        alt: '',
        decorative: true,
        glyphs,
        provenance: glyphCatalog.license
          ? `${glyphCatalog.source ?? 'game-icons.net'} / ${glyphCatalog.license}`
          : null,
      });
    }
  }

  return { assets, attribution };
}

function writeAttribution(attribution) {
  if (!attribution.length) {
    return;
  }

  const byLicense = new Map();
  for (const entry of attribution) {
    if (!byLicense.has(entry.license)) {
      byLicense.set(entry.license, []);
    }
    byLicense.get(entry.license).push(entry);
  }

  const lines = [
    '# Onboarding media attribution',
    '',
    'Generated by scripts/process-onboarding-media.mjs. Do not edit by hand.',
    '',
  ];
  for (const [license, entries] of [...byLicense.entries()].sort()) {
    lines.push(`## ${license}`, '');
    for (const entry of entries.sort((a, b) => a.key.localeCompare(b.key))) {
      lines.push(`- ${entry.key} - ${entry.creator}${entry.source ? ` - ${entry.source}` : ''}`);
    }
    lines.push('');
  }

  ensureDir(outputRoot);
  fs.writeFileSync(path.join(outputRoot, 'ATTRIBUTION.md'), lines.join('\n'));
}

function main() {
  const metadata = readMetadata();
  ensureDir(outputRoot);

  const imageRecords = discoverSources().filter(
    (record) => !onlyPrefix || record.key.startsWith(onlyPrefix),
  );

  const assets = [];
  const skipped = [];

  for (const record of imageRecords) {
    try {
      const entry = processImageAsset(record, metadata);
      if (entry) {
        assets.push(entry);
      } else {
        skipped.push(`${record.key} (no profile for category "${record.category}")`);
      }
    } catch (error) {
      skipped.push(`${record.key} (${error.message})`);
    }
  }

  const downloads = processVisualDownloads(metadata);
  for (const entry of downloads.assets) {
    if (!onlyPrefix || entry.key.startsWith(onlyPrefix)) {
      assets.push(entry);
    }
  }
  writeAttribution(downloads.attribution);

  if (!onlyPrefix || audioCategories.some((category) => onlyPrefix.startsWith(category))) {
    for (const entry of processAudioPackage(metadata)) {
      if (!onlyPrefix || entry.key.startsWith(onlyPrefix)) {
        assets.push(entry);
      }
    }
  }

  assets.sort((a, b) => a.key.localeCompare(b.key));

  const manifest = {
    schema: 'luminari.onboarding.media/1',
    mediaVersion,
    generatedBy: 'scripts/process-onboarding-media.mjs',
    assetCount: assets.length,
    assets,
  };

  ensureDir(path.dirname(manifestPath));
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const previous = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : '';
  if (previous !== serialized) {
    fs.writeFileSync(manifestPath, serialized);
  }

  const images = assets.filter((asset) => asset.type === 'image');
  const audio = assets.filter((asset) => asset.type === 'audio');
  const missingAlt = images.filter((asset) => asset.altPending).map((asset) => asset.key);

  process.stdout.write(
    `Onboarding media ${mediaVersion}: ${images.length} image packs, ${audio.length} audio cues.\n`,
  );
  if (missingAlt.length) {
    process.stdout.write(
      `Alt text pending for ${missingAlt.length}: ${missingAlt.slice(0, 8).join(', ')}${
        missingAlt.length > 8 ? ', ...' : ''
      }\n`,
    );
  }
  for (const note of skipped) {
    process.stdout.write(`Skipped ${note}\n`);
  }
}

main();
