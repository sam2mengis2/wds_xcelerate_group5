// Request validation for listings.
// The enums and field shapes are copied from client/src/data/data.ts (Jeffrey's ListingSchema).
// Keep them in sync until we have a shared package.
import { z } from 'zod';

export const LISTING_KINDS = ['lease', 'sublet'] as const;
export const LISTING_TYPES = ['house', 'apartment', 'townhouse', 'room'] as const;
export const NEIGHBOURHOODS = [
  'Broughdale',
  'Old North',
  'University Heights',
  'Cherryhill',
  'Downtown',
  'Oxford Park',
  'Masonville',
] as const;
export const AMENITIES = ['laundry', 'parking', 'dishwasher', 'ac', 'wifi', 'backyard', 'gym', 'pets'] as const;

export type ListingKind = (typeof LISTING_KINDS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-05-01');

const PhotoSchema = z.object({
  hero: z.object({
    primary: z.string(),
    photos: z.string().array().min(1, 'Add at least one photo').max(4, 'Too many photos'),
  }),
  tour: z.object({
    name: z.string(),
    description: z.string(),
    photos: z.string().array(),
    primary: z.string(),
  }),
});

const count = z.number().int().min(0);

/** Fields a user can set. Server-owned fields (id, postedAt, postedBy, landlordId, westernVerified) are not accepted. */
const ListingFields = z.object({
  kind: z.enum(LISTING_KINDS),
  type: z.enum(LISTING_TYPES),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(5000),
  price: count,
  lease: z.number().int().min(1),
  address: z.string().trim().min(1).max(200),
  /**
   * Private full address with the house number ("1066 Richmond St"). Never returned by the API; only
   * matched against Western's Off-Campus Housing list for the Western Verified badge.
   */
  streetAddress: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || undefined),
  neighbourhood: z.enum(NEIGHBOURHOODS),
  housingDetails: z.object({
    beds: count,
    baths: z.number().min(0).multipleOf(0.5),
    roomsOpen: count,
  }),
  walkMinutes: count,
  busMinutes: count,
  groceryMinutes: count,
  availableFrom: isoDate,
  availableTo: isoDate.optional(),
  furnished: z.boolean(),
  utilitiesIncluded: z.boolean(),
  amenities: z.enum(AMENITIES).array(),
  photos: PhotoSchema,
});

/** Sublets need an end date after the start date. Also used after merging a PATCH. */
export function checkDates(
  v: { kind: ListingKind; availableFrom: string; availableTo?: string | undefined },
  ctx: z.RefinementCtx,
) {
  if (v.kind !== 'sublet') return;
  if (!v.availableTo) {
    ctx.addIssue({ code: 'custom', path: ['availableTo'], message: 'Sublets need an end date' });
  } else if (v.availableTo <= v.availableFrom) {
    ctx.addIssue({ code: 'custom', path: ['availableTo'], message: 'End date must be after the start date' });
  }
}

export const ListingInput = ListingFields.strict().superRefine(checkDates);

/** Used to re-check dates after merging a PATCH into the existing listing. */
export const ListingDates = z
  .object({ kind: z.enum(LISTING_KINDS), availableFrom: isoDate, availableTo: isoDate.optional() })
  .superRefine(checkDates);
export type ListingInput = z.infer<typeof ListingInput>;

/** PATCH body: any subset of the fields except kind. Unknown fields (e.g. westernVerified) are rejected. */
export const ListingPatch = ListingFields.omit({ kind: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type ListingPatch = z.infer<typeof ListingPatch>;

const queryBool = z.enum(['true', 'false']).transform((v) => v === 'true');

/** GET /api/listings query string. */
export const ListingQuery = z
  .object({
    kind: z.enum(LISTING_KINDS).optional(),
    type: z.enum(LISTING_TYPES).optional(),
    neighbourhood: z.enum(NEIGHBOURHOODS).optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    furnished: queryBool.optional(),
    /** Sublet date range: only sublets available for the whole period. */
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '`from` must be on or before `to`', path: ['to'] });
export type ListingQuery = z.infer<typeof ListingQuery>;

export const ListingId = z.uuid();
