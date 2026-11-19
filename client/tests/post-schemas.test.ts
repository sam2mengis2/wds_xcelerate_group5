import { describe, expect, test } from 'bun:test';
import {
  landlordListingSchema,
  landlordToListing,
  roommateSchema,
  roommateToPost,
  subletSchema,
  subletToListing,
} from '@/lib/post-schemas';
import { ListingSchema, RoommatePostSchema } from '@/data/data';
import { ListingInput } from '../../server/src/listings/schema.ts';

const sublet = {
  title: 'Furnished room near UC Hill',
  price: '600',
  street: 'Sarnia Rd',
  neighbourhood: 'University Heights',
  beds: '4',
  baths: '2',
  furnished: true,
  utilitiesIncluded: false,
  amenities: ['laundry'],
  description: 'A quiet room in a four-bed house with friendly housemates.',
  cover: 'bedWhite',
  name: 'Sam',
  type: 'room',
  availableFrom: '2027-05-01',
  availableTo: '2027-08-31',
};

const roommate = {
  kind: 'group',
  title: 'Two of us need two more',
  body: 'We are tidy, social on weekends and quiet on weeknights.',
  budget: '700',
  moveIn: '2027-05-01',
  months: '12',
  haveCount: '2',
  spotsTotal: '4',
  neighbourhoods: ['Broughdale'],
  tags: ['clean'],
  name: 'Sam',
  detail: '3rd-year Science',
};

const issuesAt = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }, key: string) =>
  result.error?.issues.filter((i) => i.path[0] === key).length ?? 0;

describe('post forms', () => {
  test('a good sublet passes and becomes a valid listing', () => {
    const parsed = subletSchema.parse(sublet);
    const listing = { ...subletToListing(parsed), id: 'x', postedAt: '2026-11-14T00:00:00Z' };
    expect(ListingSchema.safeParse(listing).success).toBe(true);
    expect(listing.address).toBe('Sarnia Rd, University Heights');
  });

  test('rent must be between 100 and 10000', () => {
    expect(issuesAt(subletSchema.safeParse({ ...sublet, price: '99' }), 'price')).toBe(1);
    expect(issuesAt(subletSchema.safeParse({ ...sublet, price: '10001' }), 'price')).toBe(1);
    expect(issuesAt(subletSchema.safeParse({ ...sublet, price: 'abc' }), 'price')).toBe(1);
    expect(subletSchema.safeParse({ ...sublet, price: '10000' }).success).toBe(true);
  });

  test('sublet end date must be after the start', () => {
    expect(issuesAt(subletSchema.safeParse({ ...sublet, availableTo: '2027-05-01' }), 'availableTo')).toBe(1);
  });

  test('title is 8 to 90 characters', () => {
    expect(issuesAt(subletSchema.safeParse({ ...sublet, title: 'Room' }), 'title')).toBe(1);
    expect(issuesAt(subletSchema.safeParse({ ...sublet, title: 'x'.repeat(91) }), 'title')).toBe(1);
  });

  test('a street with a house number is refused', () => {
    expect(issuesAt(subletSchema.safeParse({ ...sublet, street: '123 Sarnia Rd' }), 'street')).toBe(1);
  });

  test('a roommate post needs at least one open spot', () => {
    expect(issuesAt(roommateSchema.safeParse({ ...roommate, spotsTotal: '2' }), 'spotsTotal')).toBe(1);
    const post = { ...roommateToPost(roommateSchema.parse(roommate)), id: 'p', postedAt: '2026-11-14T00:00:00Z' };
    expect(RoommatePostSchema.safeParse(post).success).toBe(true);
    expect(post.members).toHaveLength(2);
  });

  test('a landlord listing becomes a lease and is never self-verified', () => {
    const parsed = landlordListingSchema.parse({
      ...sublet,
      type: 'house',
      lease: '12',
      roomsOpen: '4',
      onWesternList: true,
    });
    const listing = landlordToListing(parsed);
    expect(listing.kind).toBe('lease');
    expect(listing.westernVerified).toBe(false);
  });
});

// The server's own validator: if this fails, posting from the form would get a 400.
describe('form output matches the server’s ListingInput', () => {
  const strip = ({ westernVerified: _w, landlordId: _l, postedBy: _p, ...rest }: Record<string, unknown>) => rest;
  const place = {
    title: 'Furnished room near UC Hill',
    price: '650',
    street: 'Broughdale Ave',
    neighbourhood: 'Broughdale',
    beds: '4',
    baths: '1',
    furnished: true,
    utilitiesIncluded: false,
    amenities: ['laundry'],
    description: 'A bright room in a quiet four-bed house, five minutes from campus.',
    cover: 'bedWhite',
    name: 'Sam',
    availableFrom: '2027-05-01',
  };

  test('sublet', () => {
    const v = subletSchema.parse({ ...place, type: 'room', availableTo: '2027-08-31' });
    const result = ListingInput.safeParse(strip(subletToListing(v)));
    expect(result.error?.issues ?? []).toEqual([]);
  });

  test('lease', () => {
    const v = landlordListingSchema.parse({ ...place, type: 'house', lease: '12', roomsOpen: '4', onWesternList: false });
    const result = ListingInput.safeParse(strip(landlordToListing(v)));
    expect(result.error?.issues ?? []).toEqual([]);
  });

  test('house number becomes the private streetAddress used for Western Verified', () => {
    const v = landlordListingSchema.parse({ ...place, houseNumber: '1066', type: 'house', lease: '12', roomsOpen: '4', onWesternList: true });
    const listing = landlordToListing(v);
    expect(listing.streetAddress).toBe('1066 Broughdale Ave');
    expect(listing.address).toBe('Broughdale Ave, Broughdale'); // the public address still has no number
    expect(ListingInput.safeParse(strip(listing)).success).toBe(true);
  });

  test('house number is optional and must look like one', () => {
    expect(landlordToListing(landlordListingSchema.parse({ ...place, type: 'house', lease: '12', roomsOpen: '4', onWesternList: false })).streetAddress).toBeUndefined();
    expect(subletSchema.safeParse({ ...place, houseNumber: 'Unit 4', type: 'room', availableTo: '2027-08-31' }).success).toBe(false);
    expect(subletSchema.safeParse({ ...place, houseNumber: '12A', type: 'room', availableTo: '2027-08-31' }).success).toBe(true);
  });
});
