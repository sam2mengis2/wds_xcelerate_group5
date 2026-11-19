import { z } from 'zod';

/*
  Shapes for everything the app shows. The mock data (listings.ts, reviews.ts, ...) and anything a
  form creates are checked against these, and the backend should return the same shapes.
*/

export const NEIGHBOURHOODS = [
  'Broughdale',
  'Old North',
  'University Heights',
  'Cherryhill',
  'Downtown',
  'Oxford Park',
  'Masonville',
] as const;
export type Neighbourhood = (typeof NEIGHBOURHOODS)[number];

export const LISTING_KINDS = ['lease', 'sublet'] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export const LISTING_TYPES = ['house', 'apartment', 'townhouse', 'room'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const TYPE_LABELS: Record<ListingType, string> = {
  house: 'House',
  apartment: 'Apartment',
  townhouse: 'Townhouse',
  room: 'Private room',
};

export const AMENITIES = [
  'laundry',
  'parking',
  'dishwasher',
  'ac',
  'wifi',
  'backyard',
  'gym',
  'pets',
] as const;
export type Amenity = (typeof AMENITIES)[number];

export const AMENITY_LABELS: Record<Amenity, string> = {
  laundry: 'In-unit laundry',
  parking: 'Parking',
  dishwasher: 'Dishwasher',
  ac: 'Air conditioning',
  wifi: 'Wi-Fi included',
  backyard: 'Backyard',
  gym: 'Gym in building',
  pets: 'Pets allowed',
};

const HeroSchema = z.object({
  primary: z.string(),
  photos: z.string().array().min(1, 'Add at least one photo').max(4, 'Too many photos'),
});

const TourCategorySchema = z.object({
  name: z.string(),
  description: z.string(),
  photos: z.string().array(),
  primary: z.string(),
});

const PhotoSchema = z.object({
  hero: HeroSchema,
  tour: TourCategorySchema,
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-05-01');

export const ListingSchema = z.object({
  id: z.string(),
  kind: z.enum(LISTING_KINDS),
  type: z.enum(LISTING_TYPES),
  name: z.string(),
  description: z.string(),
  /** Dollars per month, per room. */
  price: z.number(),
  /** Lease length in months. */
  lease: z.number(),
  /** Street and district only. No house numbers. */
  address: z.string(),
  /** Private full address, only sent when posting (for Western Verified). The API never returns it. */
  streetAddress: z.string().optional(),
  neighbourhood: z.enum(NEIGHBOURHOODS),
  housingDetails: z.object({
    beds: z.number(),
    baths: z.number(),
    /** Rooms still available. */
    roomsOpen: z.number(),
  }),
  /** Minutes to campus on foot and by bus, and on foot to the nearest grocery store. */
  walkMinutes: z.number(),
  busMinutes: z.number(),
  groceryMinutes: z.number(),
  availableFrom: isoDate,
  /** Sublets end; leases don't. */
  availableTo: isoDate.optional(),
  furnished: z.boolean(),
  utilitiesIncluded: z.boolean(),
  amenities: z.enum(AMENITIES).array(),
  /** Listed on Western's Off-Campus Housing page. */
  westernVerified: z.boolean(),
  /** Leases have a landlord; sublets are posted by a student. */
  landlordId: z.string().nullable(),
  postedBy: z.string().optional(),
  postedAt: z.string(),
  photos: PhotoSchema,
});
export type ListingRecord = z.infer<typeof ListingSchema>;

/** A listing as the app reads it: the record plus its rating, worked out from its reviews. */
export type Listing = ListingRecord & { rating: number; reviewCount: number };

export const SCORE_KEYS = ['landlord', 'condition', 'value', 'quiet'] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

export const SCORE_LABELS: Record<ScoreKey, string> = {
  landlord: 'Landlord',
  condition: 'Condition',
  value: 'Value',
  quiet: 'Quiet',
};

const score = z.number().int().min(1).max(5);

export const ReviewSchema = z.object({
  id: z.string(),
  listingId: z.string(),
  author: z.object({
    name: z.string(),
    /** e.g. "3rd-year Kinesiology" */
    detail: z.string(),
  }),
  /** e.g. "2025–26" */
  livedThere: z.string(),
  rating: score,
  scores: z.object({ landlord: score, condition: score, value: score, quiet: score }),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const LandlordSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['company', 'individual']),
  about: z.string(),
  /** Year they started renting to students. */
  since: z.number(),
});
export type Landlord = z.infer<typeof LandlordSchema>;

export const POST_KINDS = ['have-place', 'need-place', 'group'] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const POST_KIND_LABELS: Record<PostKind, string> = {
  'have-place': 'Has a place',
  'need-place': 'Needs a place',
  group: 'Group forming',
};

export const VIBES = [
  'quiet',
  'social',
  'early riser',
  'night owl',
  'clean',
  'cooks often',
  'pets ok',
  'no smoking',
  'grad student',
  'women only',
  'lgbtq+ friendly',
  'varsity schedule',
] as const;
export type Vibe = (typeof VIBES)[number];

export const RoommatePostSchema = z.object({
  id: z.string(),
  kind: z.enum(POST_KINDS),
  title: z.string(),
  body: z.string(),
  author: z.object({ name: z.string(), detail: z.string() }),
  /** People already in, the author included. */
  members: z.string().array(),
  /** How many people the place or group is for in total. */
  spotsTotal: z.number().int().min(1),
  /** Dollars per month each person expects to pay. */
  budget: z.number(),
  moveIn: isoDate,
  /** Lease length in months. */
  months: z.number(),
  neighbourhoods: z.enum(NEIGHBOURHOODS).array(),
  tags: z.enum(VIBES).array(),
  /** Set when the post is about a specific listing. */
  listingId: z.string().optional(),
  postedAt: z.string(),
  /** Posts from the API only (/api/groups): user ids of members on the app, creator first. */
  memberIds: z.string().array().optional(),
  /** Posts from the API only: the user who started the group. */
  createdBy: z.string().optional(),
});
export type RoommatePost = z.infer<typeof RoommatePostSchema>;

/** Open spots on a post. */
export function spotsOpen(post: RoommatePost) {
  return Math.max(0, post.spotsTotal - post.members.length);
}
