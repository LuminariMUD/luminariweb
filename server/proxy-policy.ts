import { lookup as lookupDns } from 'node:dns/promises';
import { setTimeout as wait } from 'node:timers/promises';
import type { MudPreset } from '../shared/app-settings.ts';
import {
  DEFAULT_BANNED_PROXY_PORTS,
  classifyIpAddress,
  isBannedProxyPort,
  normalizeIpLiteral,
} from './proxy-network.ts';

export const PROXY_POLICY_ENV = {
  allowedDestinations: 'PROXY_ALLOWED_DESTINATIONS',
  allowedOrigins: 'PROXY_ALLOWED_ORIGINS',
  allowCustomDestinations: 'PROXY_ALLOW_CUSTOM_DESTINATIONS',
  /**
   * Development-only opt-in that permits loopback and private-network MUD
   * destinations. Off by default, and ignored entirely in public mode, because
   * allowing them on a public deployment turns the proxy into an SSRF tool.
   * Cloud metadata services, link-local, multicast, and reserved ranges stay
   * blocked even when this is on.
   */
  allowLocalDestinations: 'PROXY_ALLOW_LOCAL_DESTINATIONS',
  connectTimeoutMs: 'PROXY_CONNECT_TIMEOUT_MS',
  dnsRetries: 'PROXY_DNS_RETRY_COUNT',
  dnsTimeoutMs: 'PROXY_DNS_TIMEOUT_MS',
  idleTimeoutMs: 'PROXY_IDLE_TIMEOUT_MS',
  publicMode: 'PROXY_PUBLIC_MODE',
} as const;

export type ProxyMode = 'public' | 'private';

export type ProxyTimeoutSettings = {
  connectTimeoutMs: number;
  dnsRetries: number;
  dnsRetryDelayMs: number;
  dnsTimeoutMs: number;
  idleTimeoutMs: number;
};

export type ProxyPolicy = {
  allowCustomDestinations: boolean;
  allowLocalDestinations: boolean;
  allowedDestinations: ReadonlyMap<string, ProxyAllowedDestination>;
  allowedOrigins: ReadonlySet<string>;
  bannedPorts: readonly number[];
  configurationWarnings: readonly string[];
  dnsLookup: DnsLookup;
  mode: ProxyMode;
  timeouts: ProxyTimeoutSettings;
};

export type ProxyAllowedDestination = {
  host: string;
  port: number;
  source: 'preset' | 'environment';
};

export type DnsLookupAddress = {
  address: string;
  family: number;
};

export type DnsLookup = (hostname: string) => Promise<readonly DnsLookupAddress[]>;

export type ProxyPolicyDecision<T> =
  | {
      allowed: true;
      value: T;
    }
  | {
      allowed: false;
      code: ProxyPolicyRejectionCode;
      detail: string;
    };

export type ProxyPolicyRejectionCode =
  | 'banned-port'
  | 'disallowed-destination'
  | 'dns-failed'
  | 'invalid-destination'
  | 'invalid-origin'
  | 'missing-origin'
  | 'public-ip-literal'
  | 'unsafe-network';

export type ProxyDestination = {
  host: string;
  port: number;
  source: 'allowlist' | 'custom';
};

export type ProxyPolicyOptions = {
  dnsLookup?: DnsLookup;
  env?: NodeJS.ProcessEnv;
  localOriginPorts?: readonly number[];
  presets: readonly MudPreset[];
};

type NormalizedDestination = {
  host: string;
  ipLiteral: string | null;
  port: number;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const MIN_CONNECT_TIMEOUT_MS = 1_000;
const MAX_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;
const MIN_IDLE_TIMEOUT_MS = 30_000;
const MAX_IDLE_TIMEOUT_MS = 3_600_000;
const DEFAULT_DNS_TIMEOUT_MS = 3_000;
const MIN_DNS_TIMEOUT_MS = 500;
const MAX_DNS_TIMEOUT_MS = 10_000;
const DEFAULT_DNS_RETRIES = 1;
const MAX_DNS_RETRIES = 2;
const DNS_RETRY_DELAY_MS = 100;
const DEFAULT_LOCAL_ORIGIN_PORTS = [5190, 5191, 5192] as const;
const METADATA_HOSTNAMES = new Set([
  '169.254.169.254',
  '169.254.170.2',
  'metadata',
  'metadata.google.internal',
  'metadata.google.internal.',
  'localhost',
  'ip6-localhost',
]);

export function createProxyPolicy(options: ProxyPolicyOptions): ProxyPolicy {
  const env = options.env ?? process.env;
  const configurationWarnings: string[] = [];
  const publicMode = parseBooleanEnv(
    env[PROXY_POLICY_ENV.publicMode],
    true,
    PROXY_POLICY_ENV.publicMode,
    configurationWarnings,
  );
  const mode: ProxyMode = publicMode ? 'public' : 'private';
  const allowCustomDestinations = parseBooleanEnv(
    env[PROXY_POLICY_ENV.allowCustomDestinations],
    mode === 'private',
    PROXY_POLICY_ENV.allowCustomDestinations,
    configurationWarnings,
  );

  const requestedLocalDestinations = parseBooleanEnv(
    env[PROXY_POLICY_ENV.allowLocalDestinations],
    false,
    PROXY_POLICY_ENV.allowLocalDestinations,
    configurationWarnings,
  );
  // A public deployment must never proxy to loopback or private networks, so
  // the request is refused rather than honored quietly.
  const allowLocalDestinations = requestedLocalDestinations && mode === 'private';
  if (requestedLocalDestinations && !allowLocalDestinations) {
    configurationWarnings.push(
      `${PROXY_POLICY_ENV.allowLocalDestinations} is ignored in public mode.`,
    );
  } else if (allowLocalDestinations) {
    configurationWarnings.push(
      `${PROXY_POLICY_ENV.allowLocalDestinations} is enabled: loopback and private-network MUD destinations are permitted. Use this on a developer machine only.`,
    );
  }

  const allowedDestinations = new Map<string, ProxyAllowedDestination>();
  for (const preset of options.presets) {
    const destination = normalizeDestinationInput(preset.host, preset.port);
    if (!destination || isBannedProxyPort(destination.port)) {
      configurationWarnings.push('Invalid curated MUD preset ignored.');
      continue;
    }

    allowedDestinations.set(destinationKey(destination.host, destination.port), {
      host: destination.host,
      port: destination.port,
      source: 'preset',
    });
  }

  for (const destination of parseAllowedDestinationsEnv(
    env[PROXY_POLICY_ENV.allowedDestinations],
    configurationWarnings,
  )) {
    allowedDestinations.set(destinationKey(destination.host, destination.port), destination);
  }

  const allowedOrigins = new Set([
    ...buildLocalDevelopmentOrigins(options.localOriginPorts ?? DEFAULT_LOCAL_ORIGIN_PORTS),
    ...parseAllowedOriginsEnv(env[PROXY_POLICY_ENV.allowedOrigins], configurationWarnings),
  ]);

  return {
    allowCustomDestinations,
    allowLocalDestinations,
    allowedDestinations,
    allowedOrigins,
    bannedPorts: DEFAULT_BANNED_PROXY_PORTS,
    configurationWarnings,
    dnsLookup: options.dnsLookup ?? defaultDnsLookup,
    mode,
    timeouts: parseTimeoutSettings(env, configurationWarnings),
  };
}

export function checkWebSocketOrigin(
  policy: ProxyPolicy,
  originHeader: string | undefined,
): ProxyPolicyDecision<{ origin: string | null }> {
  if (policy.mode === 'private') {
    return allow({ origin: originHeader ?? null });
  }

  if (!originHeader) {
    return reject('missing-origin', 'WebSocket origin is not allowed.');
  }

  const origin = normalizeOrigin(originHeader);
  if (!origin) {
    return reject('invalid-origin', 'WebSocket origin is not allowed.');
  }

  if (!policy.allowedOrigins.has(origin)) {
    return reject('invalid-origin', 'WebSocket origin is not allowed.');
  }

  return allow({ origin });
}

export async function validateProxyDestination(
  policy: ProxyPolicy,
  input: { host: unknown; port: unknown },
): Promise<ProxyPolicyDecision<ProxyDestination>> {
  const destination = normalizeDestinationInput(input.host, input.port);
  if (!destination) {
    return reject('invalid-destination', 'Provide a valid MUD host and port.');
  }

  if (isBannedProxyPort(destination.port, policy.bannedPorts)) {
    return reject('banned-port', 'This MUD port is not allowed.');
  }

  if (isBlockedMetadataHostname(destination.host)) {
    return reject('disallowed-destination', 'This MUD destination is not allowed.');
  }

  const key = destinationKey(destination.host, destination.port);
  const isAllowlisted = policy.allowedDestinations.has(key);

  if (policy.mode === 'public' && destination.ipLiteral && !isAllowlisted) {
    return reject(
      'public-ip-literal',
      'Direct IP MUD destinations are not allowed in public mode.',
    );
  }

  if (!isAllowlisted && !policy.allowCustomDestinations) {
    return reject('disallowed-destination', 'This MUD destination is not allowed.');
  }

  if (destination.ipLiteral) {
    const addressDecision = classifyNetworkAddress(policy, destination.ipLiteral);
    if (!addressDecision.allowed) {
      return addressDecision;
    }
  } else {
    const dnsDecision = await resolveDestinationAddresses(policy, destination.host);
    if (!dnsDecision.allowed) {
      return dnsDecision;
    }
  }

  return allow({
    host: destination.host,
    port: destination.port,
    source: isAllowlisted ? 'allowlist' : 'custom',
  });
}

export function destinationKey(host: string, port: number) {
  return `${host}:${port}`;
}

function parseAllowedDestinationsEnv(value: string | undefined, warnings: string[]) {
  const destinations: ProxyAllowedDestination[] = [];
  for (const item of splitEnvList(value)) {
    const parsed = parseDestinationRule(item);
    if (!parsed || isBannedProxyPort(parsed.port)) {
      warnings.push('Invalid PROXY_ALLOWED_DESTINATIONS entry ignored.');
      continue;
    }

    destinations.push({
      host: parsed.host,
      port: parsed.port,
      source: 'environment',
    });
  }

  return destinations;
}

function parseAllowedOriginsEnv(value: string | undefined, warnings: string[]) {
  const origins: string[] = [];
  for (const item of splitEnvList(value)) {
    const origin = normalizeOrigin(item);
    if (!origin) {
      warnings.push('Invalid PROXY_ALLOWED_ORIGINS entry ignored.');
      continue;
    }

    origins.push(origin);
  }

  return origins;
}

function parseDestinationRule(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('[')) {
    const closingBracketIndex = trimmed.indexOf(']');
    if (closingBracketIndex <= 0 || trimmed[closingBracketIndex + 1] !== ':') {
      return null;
    }

    const host = trimmed.slice(1, closingBracketIndex);
    const port = Number(trimmed.slice(closingBracketIndex + 2));
    return normalizeDestinationInput(host, port);
  }

  const separatorIndex = trimmed.lastIndexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }

  const host = trimmed.slice(0, separatorIndex);
  const port = Number(trimmed.slice(separatorIndex + 1));
  return normalizeDestinationInput(host, port);
}

function normalizeDestinationInput(host: unknown, port: unknown): NormalizedDestination | null {
  if (typeof host !== 'string' || typeof port !== 'number' || !Number.isInteger(port)) {
    return null;
  }

  if (port < 1 || port > 65535) {
    return null;
  }

  const trimmedHost = host.trim();
  if (!trimmedHost) {
    return null;
  }

  const ipLiteral = normalizeIpLiteral(trimmedHost);
  if (ipLiteral) {
    return {
      host: ipLiteral,
      ipLiteral,
      port,
    };
  }

  const hostname = normalizeHostname(trimmedHost);
  if (!hostname) {
    return null;
  }

  return {
    host: hostname,
    ipLiteral: null,
    port,
  };
}

function normalizeHostname(host: string) {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '');
  if (normalized.length < 1 || normalized.length > 253) {
    return null;
  }

  if (/[/:?#@[\]\\]/.test(normalized)) {
    return null;
  }

  const labels = normalized.split('.');
  if (
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  ) {
    return null;
  }

  return normalized;
}

function isBlockedMetadataHostname(host: string) {
  return METADATA_HOSTNAMES.has(host) || host.endsWith('.metadata.google.internal');
}

/**
 * Risks the development opt-in may waive. Everything else - the cloud metadata
 * service, link-local, multicast, reserved, and unspecified addresses - stays
 * blocked no matter how the proxy is configured.
 */
const LOCAL_DEVELOPMENT_RISKS = new Set(['loopback', 'private']);

function classifyNetworkAddress(policy: ProxyPolicy, address: string): ProxyPolicyDecision<null> {
  const classification = classifyIpAddress(address);
  if (classification.isPublic) {
    return allow(null);
  }

  if (
    policy.allowLocalDestinations &&
    classification.risks.length > 0 &&
    classification.risks.every((risk) => LOCAL_DEVELOPMENT_RISKS.has(risk))
  ) {
    return allow(null);
  }

  return reject('unsafe-network', 'This MUD destination resolves to a blocked network.');
}

async function resolveDestinationAddresses(
  policy: ProxyPolicy,
  hostname: string,
): Promise<ProxyPolicyDecision<null>> {
  let addresses: readonly DnsLookupAddress[];

  try {
    addresses = await lookupWithRetry(policy, hostname);
  } catch {
    return reject('dns-failed', 'This MUD destination could not be verified.');
  }

  if (addresses.length === 0) {
    return reject('dns-failed', 'This MUD destination could not be verified.');
  }

  for (const address of addresses) {
    const addressDecision = classifyNetworkAddress(policy, address.address);
    if (!addressDecision.allowed) {
      return addressDecision;
    }
  }

  return allow(null);
}

async function lookupWithRetry(policy: ProxyPolicy, hostname: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= policy.timeouts.dnsRetries; attempt += 1) {
    try {
      return await withTimeout(policy.dnsLookup(hostname), policy.timeouts.dnsTimeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < policy.timeouts.dnsRetries) {
        await wait(policy.timeouts.dnsRetryDelayMs * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('DNS lookup failed.');
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_resolve, rejectPromise) => {
    timeoutHandle = setTimeout(() => {
      rejectPromise(new Error('DNS lookup timed out.'));
    }, timeoutMs);
  });

  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}

function defaultDnsLookup(hostname: string) {
  return lookupDns(hostname, { all: true, verbatim: true });
}

function parseTimeoutSettings(env: NodeJS.ProcessEnv, warnings: string[]): ProxyTimeoutSettings {
  return {
    connectTimeoutMs: parseBoundedIntegerEnv(
      env[PROXY_POLICY_ENV.connectTimeoutMs],
      DEFAULT_CONNECT_TIMEOUT_MS,
      MIN_CONNECT_TIMEOUT_MS,
      MAX_CONNECT_TIMEOUT_MS,
      PROXY_POLICY_ENV.connectTimeoutMs,
      warnings,
    ),
    dnsRetries: parseBoundedIntegerEnv(
      env[PROXY_POLICY_ENV.dnsRetries],
      DEFAULT_DNS_RETRIES,
      0,
      MAX_DNS_RETRIES,
      PROXY_POLICY_ENV.dnsRetries,
      warnings,
    ),
    dnsRetryDelayMs: DNS_RETRY_DELAY_MS,
    dnsTimeoutMs: parseBoundedIntegerEnv(
      env[PROXY_POLICY_ENV.dnsTimeoutMs],
      DEFAULT_DNS_TIMEOUT_MS,
      MIN_DNS_TIMEOUT_MS,
      MAX_DNS_TIMEOUT_MS,
      PROXY_POLICY_ENV.dnsTimeoutMs,
      warnings,
    ),
    idleTimeoutMs: parseBoundedIntegerEnv(
      env[PROXY_POLICY_ENV.idleTimeoutMs],
      DEFAULT_IDLE_TIMEOUT_MS,
      MIN_IDLE_TIMEOUT_MS,
      MAX_IDLE_TIMEOUT_MS,
      PROXY_POLICY_ENV.idleTimeoutMs,
      warnings,
    ),
  };
}

function parseBooleanEnv(
  value: string | undefined,
  fallback: boolean,
  variableName: string,
  warnings: string[],
) {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  warnings.push(`Invalid ${variableName} value ignored.`);
  return fallback;
}

function parseBoundedIntegerEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  variableName: string,
  warnings: string[],
) {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    warnings.push(`Invalid ${variableName} value ignored.`);
    return fallback;
  }

  if (parsed < min) {
    warnings.push(`${variableName} value raised to minimum.`);
    return min;
  }

  if (parsed > max) {
    warnings.push(`${variableName} value lowered to maximum.`);
    return max;
  }

  return parsed;
}

function normalizeOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }

    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

function buildLocalDevelopmentOrigins(ports: readonly number[]) {
  const origins = new Set<string>();
  const uniquePorts = Array.from(new Set([...DEFAULT_LOCAL_ORIGIN_PORTS, ...ports]));

  for (const port of uniquePorts) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      continue;
    }

    for (const protocol of ['http', 'https']) {
      origins.add(`${protocol}://localhost:${port}`);
      origins.add(`${protocol}://127.0.0.1:${port}`);
      origins.add(`${protocol}://[::1]:${port}`);
    }
  }

  return origins;
}

function splitEnvList(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function allow<T>(value: T): ProxyPolicyDecision<T> {
  return {
    allowed: true,
    value,
  };
}

function reject<T>(code: ProxyPolicyRejectionCode, detail: string): ProxyPolicyDecision<T> {
  return {
    allowed: false,
    code,
    detail,
  };
}
