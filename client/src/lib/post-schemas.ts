import { z } from 'zod';
import {
  AMENITIES,
  LISTING_TYPES,
  NEIGHBOURHOODS,
  POST_KINDS,
  VIBES,
  type ListingRecord,
  type Neighbourhood,
  type RoommatePost,
} from '@/data/data';
import { PHOTOS, photoUrl, type PhotoKey } from '@/data/photos';

export const POST_TYPES = ['sublet', 'roommate', 'listing'] as const;
export type PostType = (typeof POST_TYPES)[number];

/** Rough travel times from each area, until the backend works them out from the address. */
export const AREA_TIMES: Record<Neighbourhood, { walk: number; bus: number; grocery: number }> = {
  Broughdale: { walk: 9, bus: 7, grocery: 13 },
  'Old North': { walk: 18, bus: 10, grocery: 8 },
  'University Heights': { walk: 11, bus: 6, grocery: 10 },
  Cherryhill: { walk: 22, bus: 11, grocery: 6 },
  Downtown: { walk: 35, bus: 15, grocery: 4 },
  'Oxford Park': { walk: 24, bus: 11, grocery: 7 },
  Masonville: { walk: 29, bus: 13, grocery: 4 },
};

/** Cover photos to choose from until uploads exist. */
export const COVER_CHOICES: PhotoKey[] = ['bedWhite', 'livingPlants', 'porchWhite', 'aptModern', 'bedOrange', 'brickBungalow'];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');
const title = z
  .string()
  .trim()
  .min(8, 'Write a title of at least 8 characters, like “Furnished room near UC Hill”')
  .max(90, 'Keep the title under 90 characters');
const rent = z.coerce
  .number({ message: 'Write the monthly rent as a number' })
  .int('Write the rent in whole dollars')
  .min(100, 'Rent should be at least $100 a month')
  .max(10_000, 'Rent should be under $10,000 a month');
const street = z
  .string()
  .trim()
  .min(3, 'Write the street name')
  .max(60, 'Keep the street under 60 characters')
  .refine((s) => !/^\d/.test(s), 'Leave out the house number; it is shared after someone knocks');
/** Private: only used to match Western's Off-Campus Housing list. Optional. */
const houseNumber = z
  .string()
  .trim()
  .max(10, 'Just the house number, like 1066 or 12A')
  .refine((s) => s === '' || /^\d+[a-zA-Z]?$/.test(s), 'Just the house number, like 1066 or 12A')
  .optional();
const name = z.string().trim().min(2, 'Write your name');

const placeFields = {
  title,
  price: rent,
  street,
  houseNumber,
  neighbourhood: z.enum(NEIGHBOURHOODS, { message: 'Pick the area' }),
  beds: z.coerce.number().int().min(1).max(10),
  baths: z.coerce.number().int().min(1).max(6),
  furnished: z.boolean(),
  utilitiesIncluded: z.boolean(),
  amenities: z.enum(AMENITIES).array(),
  description: z.string().trim().min(30, 'Describe the place in at least 30 characters').max(2000, 'Keep it under 2,000 characters'),
  cover: z.enum(Object.keys(PHOTOS) as [PhotoKey, ...PhotoKey[]]),
  name,
};

export const subletSchema = z
  .object({
    ...placeFields,
    type: z.enum(['room', 'apartment']),
    availableFrom: isoDate,
    availableTo: isoDate,
  })
  .refine((v) => v.availableTo > v.availableFrom, {
    path: ['availableTo'],
    message: 'The end date has to be after the start date',
  });

export const landlordListingSchema = z.object({
  ...placeFields,
  type: z.enum(LISTING_TYPES),
  availableFrom: isoDate,
  lease: z.coerce.number().int().min(1, 'Lease is at least 1 month').max(24, 'Lease is at most 24 months'),
  roomsOpen: z.coerce.number().int().min(1),
  onWesternList: z.boolean(),
});

export const roommateSchema = z
  .object({
    kind: z.enum(POST_KINDS),
    title,
    body: z.string().trim().min(30, 'Say a bit about yourself and the place: at least 30 characters').max(1500),
    budget: rent,
    moveIn: isoDate,
    months: z.coerce.number().int().min(1).max(24),
    /** People already in, you included. */
    haveCount: z.coerce.number().int().min(1),
    spotsTotal: z.coerce.number().int().min(1).max(10),
    neighbourhoods: z.enum(NEIGHBOURHOODS).array().min(1, 'Pick at least one area'),
    tags: z.enum(VIBES).array(),
    name,
    detail: z.string().trim().min(2, 'Write your year and program'),
  })
  .refine((v) => v.spotsTotal > v.haveCount, {
    path: ['spotsTotal'],
    message: 'Leave at least one open spot: the total has to be more than the people you already have',
  });

export type SubletValues = z.input<typeof subletSchema>;
export type LandlordValues = z.input<typeof landlordListingSchema>;
export type RoommateValues = z.input<typeof roommateSchema>;

/** Turns a validated form into the issues-by-field map the form shows. */
export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0]);
    out[key] ??= issue.message;
  }
  return out;
}

function photosFor(cover: PhotoKey) {
  const rest = COVER_CHOICES.filter((c) => c !== cover).slice(0, 3);
  return { hero: { primary: photoUrl(cover), photos: [cover, ...rest].map(photoUrl) }, tour: { name: 'Photos', description: 'More photos from the poster.', photos: [], primary: photoUrl(cover) } };
}

export function subletToListing(v: z.output<typeof subletSchema>): Omit<ListingRecord, 'id' | 'postedAt'> {
  const times = AREA_TIMES[v.neighbourhood];
  const months = Math.max(1, Math.round((Date.parse(v.availableTo) - Date.parse(v.availableFrom)) / (30 * 86_400_000)));
  return {
    kind: 'sublet',
    type: v.type,
    name: v.title,
    description: v.description,
    price: v.price,
    lease: months,
    address: `${v.street}, ${v.neighbourhood}`,
    streetAddress: v.houseNumber ? `${v.houseNumber} ${v.street}` : undefined,
    neighbourhood: v.neighbourhood,
    housingDetails: { beds: v.beds, baths: v.baths, roomsOpen: v.type === 'room' ? 1 : v.beds },
    walkMinutes: times.walk,
    busMinutes: times.bus,
    groceryMinutes: times.grocery,
    availableFrom: v.availableFrom,
    availableTo: v.availableTo,
    furnished: v.furnished,
    utilitiesIncluded: v.utilitiesIncluded,
    amenities: v.amenities,
    westernVerified: false,
    landlordId: null,
    postedBy: v.name,
    photos: photosFor(v.cover),
  };
}

export function landlordToListing(v: z.output<typeof landlordListingSchema>): Omit<ListingRecord, 'id' | 'postedAt'> {
  const times = AREA_TIMES[v.neighbourhood];
  return {
    kind: 'lease',
    type: v.type,
    name: v.title,
    description: v.description,
    price: v.price,
    lease: v.lease,
    address: `${v.street}, ${v.neighbourhood}`,
    streetAddress: v.houseNumber ? `${v.houseNumber} ${v.street}` : undefined,
    neighbourhood: v.neighbourhood,
    housingDetails: { beds: v.beds, baths: v.baths, roomsOpen: Math.min(v.roomsOpen, v.beds) },
    walkMinutes: times.walk,
    busMinutes: times.bus,
    groceryMinutes: times.grocery,
    availableFrom: v.availableFrom,
    furnished: v.furnished,
    utilitiesIncluded: v.utilitiesIncluded,
    amenities: v.amenities,
    // The server sets this when streetAddress is on Western's Off-Campus Housing list.
    westernVerified: false,
    landlordId: null,
    postedBy: v.name,
    photos: photosFor(v.cover),
  };
}

export function roommateToPost(v: z.output<typeof roommateSchema>): Omit<RoommatePost, 'id' | 'postedAt'> {
  const friends = Array.from({ length: v.haveCount - 1 }, (_, i) => `Housemate ${i + 1}`);
  return {
    kind: v.kind,
    title: v.title,
    body: v.body,
    author: { name: v.name, detail: v.detail },
    members: [v.name, ...friends],
    spotsTotal: v.spotsTotal,
    budget: v.budget,
    moveIn: v.moveIn,
    months: v.months,
    neighbourhoods: v.neighbourhoods,
    tags: v.tags,
  };
}
