// Walks every page of Western's listings.
import { ScrapeError, type Fetcher } from './fetcher.ts';
import {
  FIRST_PAGE_URL,
  parseListingsPage,
  searchFormFields,
  withPage,
  type WesternListing,
} from './western.ts';

export interface ScrapeResult {
  listings: WesternListing[];
  pages: number;
  /** Western's own count. If we got far fewer, something went wrong and nothing gets un-verified. */
  total: number;
  /** Cards we couldn't read, e.g. "61959: no price". */
  skipped: string[];
}

/** Hard stop in case paging misbehaves: 1003 listings / 50 per page = 21 pages in Nov 2026. */
const MAX_PAGES = 60;

export async function scrapeWestern(
  fetcher: Fetcher,
  log: (msg: string) => void = () => {},
): Promise<ScrapeResult> {
  const firstHtml = await fetcher.get(FIRST_PAGE_URL);
  const first = parseListingsPage(firstHtml);
  if (!first.total || !first.perPage) {
    throw new ScrapeError(
      `Couldn't read Western's first page (${first.skipped.join('; ')}). Has the site changed?`,
    );
  }

  const pageCount = Math.ceil(first.total / first.perPage);
  if (pageCount > MAX_PAGES)
    throw new ScrapeError(`Western says ${pageCount} pages; refusing more than ${MAX_PAGES}`);
  log(`page 1/${pageCount}: ${first.listings.length} listings (${first.total} total)`);

  const form = searchFormFields(firstHtml);
  if (!form)
    throw new ScrapeError("Couldn't find Western's search form, so we can't page through results");

  const byId = new Map(first.listings.map((l) => [l.westernId, l]));
  const skipped = [...first.skipped];

  for (let page = 1; page < pageCount; page++) {
    const html = await fetcher.postForm(form.action, withPage(form.fields, page), FIRST_PAGE_URL);
    const parsed = parseListingsPage(html);
    // Make sure we really got page N and not page 1 again (e.g. if the form changed).
    const expectedFirst = page * first.perPage + 1;
    if (parsed.first !== expectedFirst) {
      throw new ScrapeError(
        `Asked for page ${page + 1} but got results starting at ${parsed.first} (expected ${expectedFirst})`,
      );
    }
    for (const l of parsed.listings) byId.set(l.westernId, l);
    skipped.push(...parsed.skipped);
    log(`page ${page + 1}/${pageCount}: ${parsed.listings.length} listings`);
  }

  return { listings: [...byId.values()], pages: pageCount, total: first.total, skipped };
}
