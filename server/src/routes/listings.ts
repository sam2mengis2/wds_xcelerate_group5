// Listings API. Leases and sublets share these routes; a sublet is kind = 'sublet'.
import { Router, type RequestHandler } from 'express';
import type { Pool } from 'pg';
import type { AuthUser, Role } from '../auth/types.ts';
import { ListingDates, ListingId, ListingInput, ListingPatch, ListingQuery } from '../listings/schema.ts';
import {
  createListing,
  deleteListing,
  getListing,
  listByPoster,
  listListings,
  updateListing,
  MAX_ACTIVE_SUBLETS,
  type Listing,
} from '../listings/repo.ts';
import { verifyListing } from '../verification/sync.ts';

interface Deps {
  pool: Pool;
  /** requireAuth middleware (sets req.user). */
  auth: RequestHandler;
  /** Re-checks one listing against Western's list. Swappable for tests. */
  verify?: (pool: Pool, listingId: string) => Promise<boolean>;
}

/** Which roles may post each kind of listing. */
export const POST_ROLES: Record<Listing['kind'], Role[]> = {
  sublet: ['student'],
  lease: ['landlord', 'admin'],
};

/** Only the person who posted a listing, or an admin, can change or delete it. */
export function canEdit(user: AuthUser, listing: Pick<Listing, 'postedBy'>): boolean {
  return user.role === 'admin' || listing.postedBy === user.id;
}

/** Returns the listing id from the URL, or null if it isn't a valid UUID. */
function parseId(id: unknown): string | null {
  const parsed = ListingId.safeParse(id);
  return parsed.success ? parsed.data : null;
}

export function listingsRouter({ pool, auth, verify = verifyListing }: Deps): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = ListingQuery.parse(req.query);
    res.json(await listListings(pool, query));
  });

  router.get('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const listing = id && (await getListing(pool, id));
    if (!listing) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(listing);
  });

  router.post('/', auth, async (req, res) => {
    const user = req.user!;
    const input = ListingInput.parse(req.body);
    if (!POST_ROLES[input.kind].includes(user.role)) {
      res.status(403).json({
        error: 'forbidden',
        message: input.kind === 'sublet' ? 'Only students can post sublets' : 'Only landlords can post leases',
      });
      return;
    }

    const result = await createListing(pool, input, user);
    if (!result.ok) {
      res.status(409).json({
        error: 'sublet_limit',
        message: `You can have at most ${MAX_ACTIVE_SUBLETS} active sublets`,
      });
      return;
    }
    // Already on Western's list? Badge it now instead of waiting for the next scrape.
    if (input.streetAddress) result.listing.westernVerified = await verify(pool, result.listing.id);
    res.status(201).json(result.listing);
  });

  router.patch('/:id', auth, async (req, res) => {
    const id = parseId(req.params.id);
    const existing = id && (await getListing(pool, id));
    if (!id || !existing) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!canEdit(req.user!, existing)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const patch = ListingPatch.parse(req.body);
    // Re-check sublet dates against the merged result (e.g. moving only the start date).
    ListingDates.parse({
        kind: existing.kind,
        availableFrom: patch.availableFrom ?? existing.availableFrom,
        availableTo: patch.availableTo ?? existing.availableTo,
      });

    const updated = await updateListing(pool, id, patch);
    if (!updated) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (patch.streetAddress !== undefined) updated.westernVerified = await verify(pool, id);
    res.json(updated);
  });

  router.delete('/:id', auth, async (req, res) => {
    const id = parseId(req.params.id);
    const existing = id && (await getListing(pool, id));
    if (!id || !existing) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!canEdit(req.user!, existing)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    await deleteListing(pool, id);
    res.status(204).end();
  });

  return router;
}

/** Routes about the signed-in user's own data. */
export function meRouter({ pool, auth }: Deps): Router {
  const router = Router();

  // Everything the user has posted, including sublets that have ended.
  router.get('/listings', auth, async (req, res) => {
    res.json(await listByPoster(pool, req.user!.id));
  });

  return router;
}
