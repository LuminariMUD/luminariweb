import net from 'node:net';

export type NetworkRisk =
  | 'invalid-address'
  | 'metadata-service'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'multicast'
  | 'reserved'
  | 'unspecified';

export type IpAddressClassification = {
  family: 4 | 6 | null;
  isPublic: boolean;
  mappedIpv4: string | null;
  normalizedAddress: string | null;
  risks: NetworkRisk[];
};

export const DEFAULT_BANNED_PROXY_PORTS = [
  20, 21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 389, 443, 445, 465, 587, 993, 995, 1433, 1521,
  2049, 2375, 2376, 3306, 3389, 5432, 5672, 5900, 6379, 8000, 8080, 8443, 9200, 9300, 11211, 27017,
] as const;

const IPV6_TOTAL_BITS = 128n;

export function isBannedProxyPort(
  port: number,
  bannedPorts: readonly number[] = DEFAULT_BANNED_PROXY_PORTS,
) {
  return bannedPorts.includes(port);
}

export function normalizeIpLiteral(input: string) {
  const trimmed = input.trim().toLowerCase();
  const unbracketed =
    trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;

  if (unbracketed.includes('%')) {
    return null;
  }

  return net.isIP(unbracketed) === 0 ? null : unbracketed;
}

export function classifyIpAddress(input: string): IpAddressClassification {
  const normalizedAddress = normalizeIpLiteral(input);
  if (!normalizedAddress) {
    return invalidClassification();
  }

  const family = net.isIP(normalizedAddress);
  if (family === 4) {
    return classifyIpv4Address(normalizedAddress);
  }

  if (family === 6) {
    return classifyIpv6Address(normalizedAddress);
  }

  return invalidClassification();
}

function classifyIpv4Address(address: string): IpAddressClassification {
  const octets = parseIpv4Octets(address);
  if (!octets) {
    return invalidClassification();
  }

  const risks: NetworkRisk[] = [];
  const [a, b, c, d] = octets;

  if (
    (a === 169 && b === 254 && c === 169 && d === 254) ||
    (a === 169 && b === 254 && c === 170 && d === 2) ||
    (a === 168 && b === 63 && c === 129 && d === 16) ||
    (a === 100 && b === 100 && c === 100 && d === 200)
  ) {
    risks.push('metadata-service');
  }

  if (a === 0) {
    risks.push('unspecified');
  }

  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    risks.push('private');
  }

  if (a === 127) {
    risks.push('loopback');
  }

  if (a === 169 && b === 254) {
    risks.push('link-local');
  }

  if (a >= 224 && a <= 239) {
    risks.push('multicast');
  }

  if (
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 240
  ) {
    risks.push('reserved');
  }

  return {
    family: 4,
    isPublic: risks.length === 0,
    mappedIpv4: null,
    normalizedAddress: address,
    risks: dedupeRisks(risks),
  };
}

function classifyIpv6Address(address: string): IpAddressClassification {
  const parts = parseIpv6Parts(address);
  if (!parts) {
    return invalidClassification();
  }

  const mappedIpv4 = getMappedIpv4Address(parts);
  if (mappedIpv4) {
    const mappedClassification = classifyIpv4Address(mappedIpv4);
    return {
      family: 6,
      isPublic: mappedClassification.isPublic,
      mappedIpv4,
      normalizedAddress: address,
      risks: mappedClassification.risks,
    };
  }

  const risks: NetworkRisk[] = [];
  const value = ipv6PartsToBigInt(parts);

  if (value === 0n) {
    risks.push('unspecified');
  }

  if (value === 1n) {
    risks.push('loopback');
  }

  if (isIpv6InCidr(value, 'fc00::', 7)) {
    risks.push('private');
  }

  if (isIpv6InCidr(value, 'fe80::', 10)) {
    risks.push('link-local');
  }

  if (isIpv6InCidr(value, 'ff00::', 8)) {
    risks.push('multicast');
  }

  if (
    isIpv6InCidr(value, '100::', 64) ||
    isIpv6InCidr(value, '2001:db8::', 32) ||
    isIpv6InCidr(value, '2002::', 16)
  ) {
    risks.push('reserved');
  }

  return {
    family: 6,
    isPublic: risks.length === 0,
    mappedIpv4: null,
    normalizedAddress: address,
    risks: dedupeRisks(risks),
  };
}

function parseIpv4Octets(address: string) {
  if (net.isIP(address) !== 4) {
    return null;
  }

  const octets = address.split('.').map((part) => Number(part));
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet))
    ? (octets as [number, number, number, number])
    : null;
}

function parseIpv6Parts(address: string) {
  if (address.includes('%')) {
    return null;
  }

  const expandedAddress = expandIpv4Tail(address.toLowerCase());
  if (!expandedAddress) {
    return null;
  }

  const sections = expandedAddress.split('::');
  if (sections.length > 2) {
    return null;
  }

  const hasCompression = sections.length === 2;
  const head = parseIpv6Section(sections[0]);
  const tail = hasCompression ? parseIpv6Section(sections[1]) : [];

  if (!head || !tail) {
    return null;
  }

  const missingParts = 8 - head.length - tail.length;
  if (hasCompression ? missingParts < 1 : missingParts !== 0) {
    return null;
  }

  return [...head, ...Array<number>(missingParts).fill(0), ...tail];
}

function parseIpv6Section(section: string) {
  if (section === '') {
    return [];
  }

  const parts = section.split(':');
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }

  return parts.map((part) => Number.parseInt(part, 16));
}

function expandIpv4Tail(address: string) {
  const lastColonIndex = address.lastIndexOf(':');
  if (lastColonIndex === -1) {
    return address;
  }

  const maybeIpv4 = address.slice(lastColonIndex + 1);
  if (!maybeIpv4.includes('.')) {
    return address;
  }

  const octets = parseIpv4Octets(maybeIpv4);
  if (!octets) {
    return null;
  }

  const high = (octets[0] << 8) + octets[1];
  const low = (octets[2] << 8) + octets[3];
  return `${address.slice(0, lastColonIndex + 1)}${high.toString(16)}:${low.toString(16)}`;
}

function getMappedIpv4Address(parts: readonly number[]) {
  const isMapped =
    parts.length === 8 &&
    parts[0] === 0 &&
    parts[1] === 0 &&
    parts[2] === 0 &&
    parts[3] === 0 &&
    parts[4] === 0 &&
    parts[5] === 0xffff;

  if (!isMapped) {
    return null;
  }

  const high = parts[6];
  const low = parts[7];
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isIpv6InCidr(value: bigint, baseAddress: string, prefixLength: number) {
  const baseParts = parseIpv6Parts(baseAddress);
  if (!baseParts) {
    return false;
  }

  const baseValue = ipv6PartsToBigInt(baseParts);
  const hostBits = IPV6_TOTAL_BITS - BigInt(prefixLength);
  const mask = ((1n << BigInt(prefixLength)) - 1n) << hostBits;
  return (value & mask) === (baseValue & mask);
}

function ipv6PartsToBigInt(parts: readonly number[]) {
  return parts.reduce((value, part) => (value << 16n) + BigInt(part), 0n);
}

function invalidClassification(): IpAddressClassification {
  return {
    family: null,
    isPublic: false,
    mappedIpv4: null,
    normalizedAddress: null,
    risks: ['invalid-address'],
  };
}

function dedupeRisks(risks: readonly NetworkRisk[]) {
  return Array.from(new Set(risks));
}
