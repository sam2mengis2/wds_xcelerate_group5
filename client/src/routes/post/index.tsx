import type { ReactNode } from 'react';
import { createFileRoute, Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Check } from 'lucide-react';
import {
  AMENITIES,
  AMENITY_LABELS,
  LISTING_TYPES,
  NEIGHBOURHOODS,
  POST_KIND_LABELS,
  POST_KINDS,
  TYPE_LABELS,
  VIBES,
  type Listing,
  type RoommatePost,
} from '@/data/data';
import { ApiError, api, type Role } from '@/data/api';
import { meQueryOptions } from '@/data/queries';
import { photoUrl } from '@/data/photos';
import {
  AREA_TIMES,
  COVER_CHOICES,
  POST_TYPES,
  landlordListingSchema,
  landlordToListing,
  roommateSchema,
  roommateToPost,
  subletSchema,
  subletToListing,
  type LandlordValues,
  type PostType,
  type RoommateValues,
  type SubletValues,
} from '@/lib/post-schemas';
import { useForm } from '@/lib/useForm';
import { cn } from '@/lib/cn';
import { Button } from '@/components/Button';
import { ToggleChip } from '@/components/Chip';
import { Field, Select, TextArea, TextInput } from '@/components/Field';
import { ListingCard } from '@/components/ListingCard';
import { PageHeader } from '@/components/PageHeader';
import { Photo } from '@/components/Photo';
import { RoommatePostCard } from '@/components/RoommatePostCard';
import { Segmented } from '@/components/Segmented';

export const Route = createFileRoute('/post/')({
  validateSearch: (search: Record<string, unknown>): { type?: PostType } => ({
    type: POST_TYPES.includes(search.type as PostType) ? (search.type as PostType) : undefined,
  }),
  component: PostPage,
});

const COPY: Record<PostType, { title: string; quiet: string; intro: string; tone: 'mint' | 'peach' | 'sky' }> = {
  sublet: {
    title: 'Sublet your room',
    quiet: 'While you’re on co-op, exchange or summer break',
    intro: 'Students looking for a term-long place see sublets first. Check that your lease allows subletting before you post.',
    tone: 'mint',
  },
  roommate: {
    title: 'Find housemates',
    quiet: 'Fill a room, or find a house to join',
    intro: 'Say who you are and what you’re looking for. People knock on your post; if you knock back, you can talk.',
    tone: 'peach',
  },
  listing: {
    title: 'List a property',
    quiet: 'For landlords and property managers',
    intro: 'Listings on Western’s Off-Campus Housing page get the Western Verified badge once we match them.',
    tone: 'sky',
  },
};

function PostPage() {
  const { type = 'sublet' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const copy = COPY[type];

  return (
    <>
      <PageHeader
        tone={copy.tone}
        title={copy.title}
        quiet={copy.quiet}
        actions={
          <Segmented
            label="What are you posting?"
            value={type}
            onChange={(t) => navigate({ search: { type: t }, replace: true, resetScroll: false })}
            options={[
              { value: 'sublet', label: 'Sublet' },
              { value: 'roommate', label: 'Roommate ad' },
              { value: 'listing', label: 'Property' },
            ]}
            className="bg-white/70"
          />
        }
      >
        {copy.intro}
      </PageHeader>
      <div className="wrap pt-10 pb-24">
        {type === 'sublet' && (
          <SignedInAs key="sublet" roles={['student']} wrongRole="Only students with a verified @uwo.ca or @ivey.ca email can post sublets.">
            <SubletForm />
          </SignedInAs>
        )}
        {type === 'roommate' && (
          <SignedInAs key="roommate" roles={['student']} wrongRole="Only students with a verified @uwo.ca or @ivey.ca email can post roommate ads.">
            <RoommateForm />
          </SignedInAs>
        )}
        {type === 'listing' && (
          <SignedInAs key="listing" roles={['landlord', 'admin']} wrongRole="Student accounts can post sublets, not leases. Landlords sign up with their own email.">
            <LandlordForm />
          </SignedInAs>
        )}
      </div>
    </>
  );
}

/* ---------- Sublet ---------- */

const today = new Date().toISOString().slice(0, 10);

const subletInitial: SubletValues = {
  title: '',
  price: '',
  street: '',
  houseNumber: '',
  neighbourhood: 'Broughdale',
  beds: '4',
  baths: '1',
  furnished: true,
  utilitiesIncluded: false,
  amenities: [],
  description: '',
  cover: 'bedWhite',
  name: '',
  type: 'room',
  availableFrom: '2027-05-01',
  availableTo: '2027-08-31',
};

function SubletForm() {
  const form = useForm(subletSchema, subletInitial);
  const { values: v, errors, set } = form;
  const create = useCreateListing();

  return (
    <Layout
      preview={<ListingCard listing={previewListing({ ...v, kind: 'sublet', availableTo: v.availableTo })} />}
      onSubmit={form.handleSubmit((data) => create.mutate(subletToListing(data)))}
      pending={create.isPending}
      error={create.error}
      submitLabel="Post sublet"
    >
      <Group title="The place">
        <Field label="Title" error={errors.title} className="sm:col-span-2">
          {(a) => <TextInput {...a} name="title" placeholder="Summer sublet: furnished room near UC Hill" value={v.title} onChange={(e) => set('title', e.target.value)} />}
        </Field>
        <Field label="What you’re subletting">
          {(a) => (
            <Select {...a} name="type" value={v.type} onChange={(e) => set('type', e.target.value as 'room' | 'apartment')}>
              <option value="room">A room in a shared place</option>
              <option value="apartment">The whole apartment</option>
            </Select>
          )}
        </Field>
        <RentField value={v.price} error={errors.price} onChange={(p) => set('price', p)} />
        <PlaceBasics v={v} errors={errors} set={set as SetPlace} />
      </Group>
      <Group title="Dates">
        <Field label="From" error={errors.availableFrom}>
          {(a) => <TextInput {...a} type="date" name="availableFrom" min={today} value={v.availableFrom} onChange={(e) => set('availableFrom', e.target.value)} />}
        </Field>
        <Field label="Until" error={errors.availableTo}>
          {(a) => <TextInput {...a} type="date" name="availableTo" min={v.availableFrom} value={v.availableTo} onChange={(e) => set('availableTo', e.target.value)} />}
        </Field>
      </Group>
      <PlaceDetails v={v} errors={errors} set={set as SetPlace} />
      <Group title="You">
        <Field label="Your name" error={errors.name}>
          {(a) => <TextInput {...a} name="name" autoComplete="name" value={v.name} onChange={(e) => set('name', e.target.value)} />}
        </Field>
      </Group>
    </Layout>
  );
}

/* ---------- Landlord listing ---------- */

const landlordInitial: LandlordValues = {
  ...subletInitial,
  type: 'house',
  lease: '12',
  roomsOpen: '4',
  furnished: false,
  onWesternList: false,
  cover: 'porchWhite',
};

function LandlordForm() {
  const form = useForm(landlordListingSchema, landlordInitial);
  const { values: v, errors, set } = form;
  const create = useCreateListing();

  return (
    <Layout
      preview={<ListingCard listing={previewListing({ ...v, kind: 'lease' })} />}
      onSubmit={form.handleSubmit((data) => create.mutate(landlordToListing(data)))}
      pending={create.isPending}
      error={create.error}
      submitLabel="Post listing"
    >
      <Group title="The property">
        <Field label="Title" error={errors.title} className="sm:col-span-2">
          {(a) => <TextInput {...a} name="title" placeholder="Four-bedroom house on Windermere Rd" value={v.title} onChange={(e) => set('title', e.target.value)} />}
        </Field>
        <Field label="Type">
          {(a) => (
            <Select {...a} name="type" value={v.type} onChange={(e) => set('type', e.target.value as LandlordValues['type'])}>
              {LISTING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <RentField value={v.price} error={errors.price} onChange={(p) => set('price', p)} />
        <PlaceBasics v={v} errors={errors} set={set as SetPlace} />
        <Field label="Rooms available" error={errors.roomsOpen}>
          {(a) => <TextInput {...a} name="roomsOpen" type="number" inputMode="numeric" min={1} max={Number(v.beds) || 10} value={String(v.roomsOpen)} onChange={(e) => set('roomsOpen', e.target.value)} />}
        </Field>
      </Group>
      <Group title="Lease">
        <Field label="Available from" error={errors.availableFrom}>
          {(a) => <TextInput {...a} type="date" name="availableFrom" min={today} value={v.availableFrom} onChange={(e) => set('availableFrom', e.target.value)} />}
        </Field>
        <Field label="Lease length (months)" error={errors.lease}>
          {(a) => <TextInput {...a} name="lease" type="number" inputMode="numeric" min={1} max={24} value={String(v.lease)} onChange={(e) => set('lease', e.target.value)} />}
        </Field>
      </Group>
      <PlaceDetails v={v} errors={errors} set={set as SetPlace} />
      <Group title="You">
        <Field label="Your name or company" error={errors.name}>
          {(a) => <TextInput {...a} name="name" autoComplete="organization" value={v.name} onChange={(e) => set('name', e.target.value)} />}
        </Field>
        <label className="flex items-start gap-3 rounded-2xl bg-lavender p-4 text-lavender-ink sm:col-span-2">
          <input
            type="checkbox"
            checked={v.onWesternList}
            onChange={(e) => set('onWesternList', e.target.checked)}
            className="mt-1 size-4"
          />
          <span>
            <span className="inline-flex items-center gap-1.5 text-ink">
              <BadgeCheck size={16} aria-hidden="true" /> This property is on Western’s Off-Campus Housing list
            </span>
            <span className="mt-1 block font-text text-sm">
              Add the house number above and we’ll match it against Western’s listings. The Western Verified badge appears once it matches.
            </span>
          </span>
        </label>
      </Group>
    </Layout>
  );
}

/* ---------- Roommate ad ---------- */

const roommateInitial: RoommateValues = {
  kind: 'have-place',
  title: '',
  body: '',
  budget: '',
  moveIn: '2027-05-01',
  months: '12',
  haveCount: '1',
  spotsTotal: '4',
  neighbourhoods: [],
  tags: [],
  name: '',
  detail: '',
};

function RoommateForm() {
  const form = useForm(roommateSchema, roommateInitial);
  const { values: v, errors, set } = form;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: api.createRoommatePost,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roommates'] });
      navigate({ to: '/roommates' });
    },
  });

  const preview: RoommatePost = {
    id: 'preview',
    kind: v.kind,
    title: v.title || 'Your title',
    body: v.body || 'What you’re like to live with, and what you’re looking for.',
    author: { name: v.name || 'Your name', detail: v.detail || 'Year and program' },
    members: [v.name || 'You', ...Array.from({ length: Math.max(0, Number(v.haveCount) - 1) }, (_, i) => `Friend ${i + 1}`)],
    spotsTotal: Math.max(1, Number(v.spotsTotal) || 1),
    budget: Number(v.budget) || 0,
    moveIn: v.moveIn || '2027-05-01',
    months: Number(v.months) || 12,
    neighbourhoods: v.neighbourhoods.length ? v.neighbourhoods : ['Broughdale'],
    tags: v.tags,
    postedAt: new Date().toISOString(),
  };

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  return (
    <Layout
      preview={<RoommatePostCard post={preview} />}
      onSubmit={form.handleSubmit((data) => create.mutate(roommateToPost(data)))}
      pending={create.isPending}
      error={create.error}
      submitLabel="Post roommate ad"
    >
      <Group title="What kind of post">
        <div className="flex flex-wrap gap-1.5 sm:col-span-2">
          {POST_KINDS.map((k) => (
            <ToggleChip key={k} pressed={v.kind === k} onClick={() => set('kind', k)}>
              {POST_KIND_LABELS[k]}
            </ToggleChip>
          ))}
        </div>
        <Field label="Title" error={errors.title} className="sm:col-span-2">
          {(a) => <TextInput {...a} name="title" placeholder="Looking for 2 more for a five-bed on Broughdale" value={v.title} onChange={(e) => set('title', e.target.value)} />}
        </Field>
        <Field label="About you and the place" error={errors.body} className="sm:col-span-2">
          {(a) => <TextArea {...a} name="body" rows={5} value={v.body} onChange={(e) => set('body', e.target.value)} />}
        </Field>
      </Group>
      <Group title="The house">
        <Field label="People already in, you included" error={errors.haveCount}>
          {(a) => <TextInput {...a} name="haveCount" type="number" inputMode="numeric" min={1} max={9} value={String(v.haveCount)} onChange={(e) => set('haveCount', e.target.value)} />}
        </Field>
        <Field label="People in total" error={errors.spotsTotal}>
          {(a) => <TextInput {...a} name="spotsTotal" type="number" inputMode="numeric" min={2} max={10} value={String(v.spotsTotal)} onChange={(e) => set('spotsTotal', e.target.value)} />}
        </Field>
        <RentField label="Budget per person, per month" value={v.budget} error={errors.budget} onChange={(p) => set('budget', p)} name="budget" />
        <Field label="Move in" error={errors.moveIn}>
          {(a) => <TextInput {...a} type="date" name="moveIn" min={today} value={v.moveIn} onChange={(e) => set('moveIn', e.target.value)} />}
        </Field>
        <Field label="For how many months" error={errors.months}>
          {(a) => <TextInput {...a} name="months" type="number" inputMode="numeric" min={1} max={24} value={String(v.months)} onChange={(e) => set('months', e.target.value)} />}
        </Field>
        <fieldset data-field="neighbourhoods" className="sm:col-span-2">
          <legend className="mb-2 text-sm">Areas</legend>
          <div className="flex flex-wrap gap-1.5">
            {NEIGHBOURHOODS.map((n) => (
              <ToggleChip key={n} pressed={v.neighbourhoods.includes(n)} onClick={() => set('neighbourhoods', toggle(v.neighbourhoods, n))}>
                {n}
              </ToggleChip>
            ))}
          </div>
          {errors.neighbourhoods && <p className="mt-1.5 font-text text-[0.8125rem] text-danger">{errors.neighbourhoods}</p>}
        </fieldset>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm">Living style</legend>
          <div className="flex flex-wrap gap-1.5">
            {VIBES.map((t) => (
              <ToggleChip key={t} pressed={v.tags.includes(t)} onClick={() => set('tags', toggle(v.tags, t))}>
                {t}
              </ToggleChip>
            ))}
          </div>
        </fieldset>
      </Group>
      <Group title="You">
        <Field label="Your name" error={errors.name}>
          {(a) => <TextInput {...a} name="name" autoComplete="name" value={v.name} onChange={(e) => set('name', e.target.value)} />}
        </Field>
        <Field label="Year and program" error={errors.detail}>
          {(a) => <TextInput {...a} name="detail" placeholder="3rd-year Science" value={v.detail} onChange={(e) => set('detail', e.target.value)} />}
        </Field>
      </Group>
    </Layout>
  );
}

/* ---------- Shared pieces ---------- */

/** Shows the form only to a signed-in user with one of `roles`; the server enforces the same rule. */
function SignedInAs({ roles, wrongRole, children }: { roles: Role[]; wrongRole: string; children: ReactNode }) {
  const href = useRouterState({ select: (s) => s.location.href });
  const { data: me, isPending, error } = useQuery(meQueryOptions());

  if (isPending) return <p className="font-text text-ink-soft">Checking your account…</p>;
  if (error) {
    return (
      <p role="alert" className="max-w-xl rounded-xl bg-danger-wash px-4 py-3 font-text text-danger">
        {error.message}
      </p>
    );
  }
  if (!me) {
    return (
      <div className="max-w-xl rounded-2xl bg-lavender p-6 text-lavender-ink">
        <h2 className="text-xl text-ink">Sign in to post</h2>
        <p className="mt-2 font-text">Anyone can browse. Posting needs an account so people know who they’re talking to.</p>
        <Link to="/sign-in" search={{ redirect: href }} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-purple px-5 text-white">
          Sign in or create an account
        </Link>
      </div>
    );
  }
  if (!roles.includes(me.role)) {
    return <p className="max-w-xl rounded-2xl bg-butter p-6 font-text text-butter-ink">{wrongRole}</p>;
  }
  return children;
}

function useCreateListing() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: api.createListing,
    onSuccess: async (listing) => {
      await queryClient.invalidateQueries({ queryKey: ['listings'] });
      navigate({ to: '/listings/$listingId', params: { listingId: listing.id } });
    },
  });
}

type PlaceValues = SubletValues | LandlordValues;
// Shared between the sublet and landlord forms, whose value types differ slightly.
type SetPlace = (key: keyof PlaceValues & string, value: unknown) => void;

/** Street, area, beds and baths. */
function PlaceBasics({ v, errors, set }: { v: PlaceValues; errors: Record<string, string | undefined>; set: SetPlace }) {
  return (
    <>
      <Field label="Street" hint="Just the street. The full address is shared after someone knocks." error={errors.street}>
        {(a) => <TextInput {...a} name="street" placeholder="Broughdale Ave" value={v.street} onChange={(e) => set('street', e.target.value)} />}
      </Field>
      <Field
        label="House number (optional)"
        hint="Never shown. If the place is on Western’s Off-Campus Housing list, we use it to add the Western Verified badge."
        error={errors.houseNumber}
      >
        {(a) => <TextInput {...a} name="houseNumber" inputMode="numeric" placeholder="1066" value={v.houseNumber ?? ''} onChange={(e) => set('houseNumber', e.target.value)} />}
      </Field>
      <Field label="Area" hint={`About ${AREA_TIMES[v.neighbourhood as keyof typeof AREA_TIMES]?.walk ?? '–'} min walk to campus`}>
        {(a) => (
          <Select {...a} name="neighbourhood" value={v.neighbourhood} onChange={(e) => set('neighbourhood', e.target.value as PlaceValues['neighbourhood'])}>
            {NEIGHBOURHOODS.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Bedrooms in the place" error={errors.beds}>
        {(a) => <TextInput {...a} name="beds" type="number" inputMode="numeric" min={1} max={10} value={String(v.beds)} onChange={(e) => set('beds', e.target.value)} />}
      </Field>
      <Field label="Bathrooms" error={errors.baths}>
        {(a) => <TextInput {...a} name="baths" type="number" inputMode="numeric" min={1} max={6} value={String(v.baths)} onChange={(e) => set('baths', e.target.value)} />}
      </Field>
    </>
  );
}

/** Description, inclusions, amenities and the cover photo. */
function PlaceDetails({ v, errors, set }: { v: PlaceValues; errors: Record<string, string | undefined>; set: SetPlace }) {
  return (
    <Group title="Details">
      <Field label="Description" hint="Who lives there, what’s nearby, anything a tenant should know." error={errors.description} className="sm:col-span-2">
        {(a) => <TextArea {...a} name="description" rows={5} value={v.description} onChange={(e) => set('description', e.target.value)} />}
      </Field>
      <div className="flex flex-wrap gap-1.5 sm:col-span-2">
        <ToggleChip pressed={v.furnished} onClick={() => set('furnished', !v.furnished)}>
          Furnished
        </ToggleChip>
        <ToggleChip pressed={v.utilitiesIncluded} onClick={() => set('utilitiesIncluded', !v.utilitiesIncluded)}>
          Utilities included
        </ToggleChip>
        {AMENITIES.map((am) => (
          <ToggleChip
            key={am}
            pressed={v.amenities.includes(am)}
            onClick={() => set('amenities', v.amenities.includes(am) ? v.amenities.filter((x) => x !== am) : [...v.amenities, am])}
          >
            {AMENITY_LABELS[am]}
          </ToggleChip>
        ))}
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm">Cover photo</legend>
        <p className="mt-0.5 mb-3 font-text text-[0.8125rem] text-ink-faint">Photo uploads come later. Pick the closest one for now.</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {COVER_CHOICES.map((key) => (
            <label key={key} className="group relative aspect-square cursor-pointer overflow-hidden rounded-xl">
              <input type="radio" name="cover" className="peer sr-only" checked={v.cover === key} onChange={() => set('cover', key)} />
              <Photo src={photoUrl(key)} width={140} height={140} className="transition-transform duration-300 ease-out group-hover:scale-[1.04]" />
              <span className="absolute inset-0 rounded-xl ring-purple transition-shadow duration-150 peer-checked:ring-4 peer-checked:ring-inset peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-4 peer-focus-visible:outline-white" />
              <span className="absolute top-1.5 right-1.5 grid size-6 scale-50 place-items-center rounded-full bg-purple text-white opacity-0 transition-[transform,opacity] duration-150 ease-out peer-checked:scale-100 peer-checked:opacity-100">
                <Check size={14} aria-hidden="true" />
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </Group>
  );
}

function RentField({
  value,
  error,
  onChange,
  label = 'Rent per room, per month',
  name = 'price',
}: {
  value: unknown;
  error?: string;
  onChange: (value: string) => void;
  label?: string;
  name?: string;
}) {
  return (
    <Field label={label} error={error}>
      {(a) => (
        <span className="relative block">
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-soft">
            $
          </span>
          <TextInput {...a} name={name} inputMode="numeric" placeholder="650" className="pl-7 tabular-nums" value={String(value ?? '')} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))} />
        </span>
      )}
    </Field>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-8 first:border-t-0 first:pt-0">
      <h2 className="mb-5 text-xl">{title}</h2>
      <div className="grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Layout({
  children,
  preview,
  onSubmit,
  pending,
  error,
  submitLabel,
}: {
  children: ReactNode;
  preview: ReactNode;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  error: Error | null;
  submitLabel: string;
}) {
  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-16">
      <form onSubmit={onSubmit} noValidate className="min-w-0">
        {children}
        {error && (
          <p role="alert" className="mb-4 rounded-xl bg-danger-wash px-4 py-3 font-text text-sm text-danger">
            That didn’t post. {error instanceof ApiError ? error.message : 'Check your connection and try again.'}{' '}
            Nothing you typed was lost.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-8">
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? 'Posting…' : submitLabel}
          </Button>
          <p className="font-text text-sm text-ink-soft">You can edit or take it down any time.</p>
        </div>
      </form>
      <aside aria-label="Preview" className={cn('order-first lg:order-none')}>
        <div className="sticky top-24">
          <p className="mb-3 text-sm text-ink-soft">How it will look</p>
          <div className="pointer-events-none" inert>
            {preview}
          </div>
        </div>
      </aside>
    </div>
  );
}

/** A listing built from half-filled form values, for the live preview card. */
function previewListing(v: PlaceValues & { kind: 'lease' | 'sublet'; availableTo?: string }): Listing {
  const times = AREA_TIMES[v.neighbourhood as keyof typeof AREA_TIMES] ?? AREA_TIMES.Broughdale;
  const beds = Number(v.beds) || 1;
  return {
    id: 'preview',
    kind: v.kind,
    type: v.type,
    name: v.title || (v.kind === 'sublet' ? 'Your sublet title' : 'Your listing title'),
    description: v.description,
    price: Number(v.price) || 0,
    lease: 12,
    address: `${v.street || 'Street'}, ${v.neighbourhood}`,
    neighbourhood: v.neighbourhood as Listing['neighbourhood'],
    housingDetails: { beds, baths: Number(v.baths) || 1, roomsOpen: 1 },
    walkMinutes: times.walk,
    busMinutes: times.bus,
    groceryMinutes: times.grocery,
    availableFrom: v.availableFrom || '2027-05-01',
    availableTo: v.availableTo,
    furnished: v.furnished,
    utilitiesIncluded: v.utilitiesIncluded,
    amenities: v.amenities,
    westernVerified: false,
    landlordId: null,
    postedAt: new Date().toISOString(),
    photos: {
      hero: { primary: photoUrl(v.cover), photos: [photoUrl(v.cover)] },
      tour: { name: '', description: '', photos: [], primary: photoUrl(v.cover) },
    },
    rating: 0,
    reviewCount: 0,
  };
}
