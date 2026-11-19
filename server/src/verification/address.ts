// Street addresses, normalized so "1548 Richmond Streeet" and "1548 Richmond St" compare equal.
// London ON addresses only: a number, a street name, maybe a suffix (St, Ave...) and a direction (N, E...).

export interface ParsedAddress {
  /** House number, e.g. "49" or "12a". */
  number: string;
  /** Street name without suffix or direction, lowercase: "richmond", "fanshawe park". */
  name: string;
  /** Canonical suffix ("st", "ave") or null when the poster left it out. */
  suffix: string | null;
  /** "n", "e", "s", "w" or null. */
  direction: string | null;
}

export type AddressKind =
  | { kind: 'street'; address: ParsedAddress }
  /** "Regent & Harrison": we can't tell which house, so it never matches. */
  | { kind: 'intersection' }
  | { kind: 'unknown' };

/** Spellings people use (and typos seen on Western's site) mapped to one suffix. */
const SUFFIXES: Record<string, string> = {
  st: 'st',
  str: 'st',
  street: 'st',
  streeet: 'st',
  stree: 'st',
  ave: 'ave',
  av: 'ave',
  avenue: 'ave',
  rd: 'rd',
  road: 'rd',
  dr: 'dr',
  drive: 'dr',
  cres: 'cres',
  cr: 'cres',
  crescent: 'cres',
  cresent: 'cres',
  ct: 'ct',
  crt: 'ct',
  court: 'ct',
  blvd: 'blvd',
  boulevard: 'blvd',
  pl: 'pl',
  place: 'pl',
  ln: 'ln',
  lane: 'ln',
  gdns: 'gdns',
  gardens: 'gdns',
  gdn: 'gdns',
  gr: 'gr',
  grv: 'gr',
  grove: 'gr',
  terr: 'terr',
  ter: 'terr',
  terrace: 'terr',
  way: 'way',
  pkwy: 'pkwy',
  parkway: 'pkwy',
  cir: 'cir',
  circle: 'cir',
  sq: 'sq',
  square: 'sq',
  trl: 'trl',
  trail: 'trl',
  row: 'row',
  gate: 'gate',
  hts: 'hts',
  heights: 'hts',
};

const DIRECTIONS: Record<string, string> = {
  n: 'n',
  north: 'n',
  e: 'e',
  east: 'e',
  s: 's',
  south: 's',
  w: 'w',
  west: 'w',
};

/** Unit prefixes/suffixes that don't identify the building: "Unit 4 - ", "#12", "Apt 3". */
const UNIT = /\b(?:unit|apt|apartment|suite|ste|room|rm)\s*#?\s*\w+\b|#\s*\w+/gi;

export function parseAddress(raw: string): AddressKind {
  const text = raw
    .toLowerCase()
    .replace(UNIT, ' ')
    .replace(/^[\s,-]+/, '') // "Unit 4, 23 Foo St" leaves ", 23 Foo St"
    .replace(/,.*$/, '') // drop ", London ON" and anything after
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (/&|\band\b|\bat\b|\//.test(text)) return { kind: 'intersection' };

  // "12-34 Foo St" (unit-house) -> house 34; "34a Foo St" keeps the letter.
  const match = text.match(/^(?:\d+\s*-\s*)?(\d+[a-z]?)\s+(.+)$/);
  if (!match) return { kind: 'unknown' };
  const [, number, rest] = match as unknown as [string, string, string];

  const words = rest.split(' ').filter(Boolean);
  let direction: string | null = null;
  let suffix: string | null = null;

  const last = words.at(-1);
  if (last && DIRECTIONS[last] && words.length > 1) {
    direction = DIRECTIONS[last];
    words.pop();
  }
  const end = words.at(-1);
  if (end && SUFFIXES[end] && words.length > 1) {
    suffix = SUFFIXES[end];
    words.pop();
  }
  // "Oxford Street East" handled above; also catch "St George Street" (leading "st" = saint, kept).
  if (!words.length) return { kind: 'unknown' };

  return { kind: 'street', address: { number, name: words.join(' '), suffix, direction } };
}

/**
 * Same building? Number and name must match. Suffix and direction must match when both sides have one;
 * a side that left it out ("302 Wharncliffe") still matches ("302 Wharncliffe Rd N").
 */
export function sameAddress(a: ParsedAddress, b: ParsedAddress): boolean {
  if (a.number !== b.number || a.name !== b.name) return false;
  if (a.suffix && b.suffix && a.suffix !== b.suffix) return false;
  if (a.direction && b.direction && a.direction !== b.direction) return false;
  return true;
}
