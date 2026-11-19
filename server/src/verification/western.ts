// Parses pages from Western's Off-Campus Housing listings (https://offcampus.uwo.ca/listings/).
// Pure functions over HTML strings, so they're tested against saved pages with no network.
//
// Page layout (Nov 2026):
//   <div class="rental-listing">
//     <a class="rental-listing-img" style="background-image: url(...)" href="/Listings/Details/61959">
//     <div class="rental-listing-details">
//       <h2><strong><a href="/Listings/Details/61959">49 Woodward Avenue</a>
//                   <a class="location_map_link">Near South</a></strong></h2>
//       <h3><strong>$850 + per bdrm</strong>, 5 Bedroom(s) Vacant</h3>
//       <h4>Available May 1, 2027</h4>
//   "Search results: 1 - 50 (of 1003)" above the list, and a POST form (search_listings_form)
//   whose hidden PageNumber field (0-based) picks the page.
import { parse, type HTMLElement } from 'node-html-parser';

export const WESTERN_ORIGIN = 'https://offcampus.uwo.ca';
export const FIRST_PAGE_URL = `${WESTERN_ORIGIN}/listings/`;

export interface WesternListing {
  westernId: number;
  address: string;
  area: string;
  price: number;
  pricePerRoom: boolean;
  plusUtilities: boolean;
  bedroomsVacant: number;
  /** YYYY-MM-DD, or null for "Available Immediately". */
  availableFrom: string | null;
}

export interface ListingsPage {
  listings: WesternListing[];
  /** 1-based index of the first result on this page, e.g. 51 on page 2. */
  first: number;
  /** Total results across all pages. */
  total: number;
  /** Results per page, from "1 - 50". */
  perPage: number;
  /** Problems with single cards; the rest of the page still parses. */
  skipped: string[];
}

const clean = (s: string | undefined) =>
  (s ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "$1050  + per bdrm" -> 1050, utilities extra, per room. */
export function parsePrice(
  text: string,
): { price: number; pricePerRoom: boolean; plusUtilities: boolean } | null {
  const m = clean(text).match(/\$\s*([\d,]+)/);
  if (!m) return null;
  return {
    price: Number(m[1]!.replace(/,/g, '')),
    pricePerRoom: /per\s*(bdrm|bedroom|room)/i.test(text),
    plusUtilities: /\+/.test(text),
  };
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** "Available May 1, 2027" -> "2027-05-01"; "Available Immediately" -> null. Undefined if unreadable. */
export function parseAvailable(text: string): string | null | undefined {
  const t = clean(text).toLowerCase();
  if (/\bimmediately\b|\bnow\b/.test(t)) return null;
  const m = t.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return undefined;
  const month = MONTHS.findIndex((name) => name.startsWith(m[1]!.slice(0, 3)));
  if (month < 0) return undefined;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
}

function parseCard(card: HTMLElement): WesternListing | string {
  const link = card.querySelector('h2 a[href*="/Listings/Details/"]');
  const id = link?.getAttribute('href')?.match(/\/Listings\/Details\/(\d+)/i)?.[1];
  if (!link || !id) return 'card without a details link';

  const address = clean(link.text);
  const area = clean(card.querySelector('.location_map_link')?.text);
  const h3 = card.querySelector('h3');
  const price = parsePrice(h3?.querySelector('strong')?.text ?? '');
  const bedrooms = clean(h3?.text).match(/(\d+)\s*Bedroom/i)?.[1];
  const availableFrom = parseAvailable(card.querySelector('h4')?.text ?? '');

  if (!address) return `${id}: no address`;
  if (!price) return `${id}: no price`;
  if (availableFrom === undefined)
    return `${id}: unreadable date "${clean(card.querySelector('h4')?.text)}"`;

  return {
    westernId: Number(id),
    address,
    area,
    ...price,
    bedroomsVacant: bedrooms ? Number(bedrooms) : 0,
    availableFrom,
  };
}

export function parseListingsPage(html: string): ListingsPage {
  const root = parse(html);
  const counts = root.text.match(/Search results:\s*(\d+)\s*-\s*(\d+)\s*\(of\s*(\d+)\)/i);
  if (!counts) {
    // No results line: either an empty search or the site changed. Callers treat 0 total as "stop".
    return {
      listings: [],
      first: 0,
      total: 0,
      perPage: 0,
      skipped: ['no "Search results" line on the page'],
    };
  }
  const [first, last, total] = counts.slice(1, 4).map(Number) as [number, number, number];

  const listings: WesternListing[] = [];
  const skipped: string[] = [];
  const seen = new Set<number>();
  // Real cards have the image link; the page also has an empty spacer <div class="rental-listing">.
  for (const card of root.querySelectorAll('div.rental-listing')) {
    if (!card.querySelector('.rental-listing-details')) continue;
    const result = parseCard(card);
    if (typeof result === 'string') skipped.push(result);
    else if (!seen.has(result.westernId)) {
      seen.add(result.westernId);
      listings.push(result);
    }
  }
  return { listings, first, total, perPage: last - first + 1, skipped };
}

/**
 * The search form's fields as a browser would submit them, so we can POST for page N exactly like
 * clicking a page number does (GoToPage(n) sets PageNumber = n and submits).
 */
export function searchFormFields(
  html: string,
): { action: string; fields: [string, string][] } | null {
  const form = parse(html).querySelector('form.search_listings_form');
  if (!form) return null;
  const fields: [string, string][] = [];

  for (const input of form.querySelectorAll('input[name]')) {
    const name = input.getAttribute('name')!;
    const type = (input.getAttribute('type') ?? 'text').toLowerCase();
    if (['submit', 'button', 'image', 'file'].includes(type)) continue;
    if ((type === 'checkbox' || type === 'radio') && !input.hasAttribute('checked')) continue;
    fields.push([name, input.getAttribute('value') ?? (type === 'checkbox' ? 'on' : '')]);
  }
  for (const select of form.querySelectorAll('select[name]')) {
    const name = select.getAttribute('name')!;
    const options = select.querySelectorAll('option');
    const chosen = options.filter((o) => o.hasAttribute('selected'));
    // A single select sends its first option when nothing is marked selected; a multiple one sends nothing.
    const send = chosen.length || select.hasAttribute('multiple') ? chosen : options.slice(0, 1);
    for (const option of send)
      fields.push([name, option.getAttribute('value') ?? clean(option.text)]);
  }

  const action = new URL(
    form.getAttribute('action') ?? '/Listings/SearchListings',
    WESTERN_ORIGIN,
  ).toString();
  return { action, fields };
}

/** Form fields with PageNumber set to a 0-based page. */
export function withPage(fields: [string, string][], page: number): URLSearchParams {
  const body = new URLSearchParams();
  let set = false;
  for (const [name, value] of fields) {
    if (name === 'PageNumber') {
      body.append(name, String(page));
      set = true;
    } else body.append(name, value);
  }
  if (!set) body.append('PageNumber', String(page));
  return body;
}
