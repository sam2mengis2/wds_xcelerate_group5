# House Finding App

Housing app for Western (UWO) students: listings, reviews, sublets and roommate matching.

## Features

- See comments and ratings on residences and landlords.
- Find sublets, and post sublet listings when away on internship or for the summer.
- Scroll through listings and find other interested roommates.
  - Match with them.
- See the features of each listing.
  - Examples: close to campus, Western verified, near a Superstore.

## Stack

TypeScript across the whole stack.

| Layer    | Tech                     |
| -------- | ------------------------ |
| Frontend | React (TypeScript, Vite) |
| Backend  | Express.js (TypeScript)  |
| Database | PostgreSQL (Neon, AWS us-east-1) |
| Hosting  | AWS                      |

## Function Splitting

| Person  | Area                               |
| ------- | ---------------------------------- |
| Omar    | Auth, Sublets                      |
| Sam     | Landlord posting, UWO verification |
| Lavanya | UX / design                        |
| Tanya   | Join a group / party               |
| Jeffrey | Frontend                           |

## User Stories (Western students only)

**Student looking for good listings**
As a Western student, I want to read comments and reviews on a landlord or listing, so that I know beforehand whether a listing is bad.

**Student posting a sublet**
As a student on a gap semester or internship, I want to post my room for subletting, so that I don't pay full rent for a place I'm not living in.

**Student finding a sublet**
As a student coming to London for a summer or one term, I want to search sublets by date range, so that I only see places available when I need them.

**Landlord posting a listing**
As a landlord, I want to post a listing for students, so that students can find it. If it's scraped from Western's off-campus housing page, it's marked Western verified.

**Student leaving a review**
As a student who has lived somewhere, I want to rate and review the listing and landlord, so that other students can make a better choice.

**Student finding roommates**
As a student without a full group, I want to see who else is interested in a listing, so that I can find roommates to rent it with.

**Student matching with roommates**
As a student, I want to match with another student who liked the same listing, so that we can message and plan to rent together.

**Student joining a group**
As a student, I want to create or join a group for a listing, so that my roommates and I can apply together.

**Student filtering listings**
As a student, I want to filter listings by price, distance to campus, nearby stores and Western verified, so that I only see places that fit me.

**Western-only sign-up**
As a student, I want to sign up with my @uwo.ca or @ivey.ca email, so that everyone on the app is a real Western student.

## API Endpoints

All routes are prefixed with `/api`. Routes marked **Signed in:** need an `Authorization: Bearer <Neon Auth JWT>` header from a user with a verified email. Without it they return 401 (or 403 if the email isn't verified).

### Auth

Sign-up, sign-in (email + password or magic link), email verification and sign-out are handled by **Neon Auth** in the browser, not by Express.

| Method | Route      | Purpose                                   |
| ------ | ---------- | ----------------------------------------- |
| GET    | `/auth/me` | Signed in: Get the current user (id, email, name, role) |

- Roles: a verified `@uwo.ca` or `@ivey.ca` email = `student`, any other email = `landlord`. `admin` is set by hand in the `profiles` table.
- Backend usage: `router.post('/listings', auth, requireRole('landlord'), handler)` with `auth` and `requireRole` from `server/src/auth/index.ts`.

**Frontend:**
- `client/src/lib/auth.ts` sets up `@neon/auth` from `VITE_NEON_AUTH_URL` in `client/.env` (see `client/.env.example`).
- `/sign-in` signs in or creates an account with email + password. New accounts get a verification email, and the API rejects them until it's clicked.
- `client/src/data/http.ts` calls `/api/...` and adds `Authorization: Bearer <JWT>` for signed-in routes. The JWT comes from Neon's `getJWTToken()`, not `getSession().session.token` (that one is a session id, not a JWT).
- The nav and the post page read the role from `GET /api/auth/me`. Sublets need a student account and leases need a landlord account.
- Listings come from the API, and the seed listings in `client/src/data/listings.ts` are shown after them. Reviews and landlords are still local mock data in `client/src/data/api.ts` until their endpoints exist.

**Running it locally:** fill in `server/.env` and `client/.env`, run `npm run migrate -w server` once (and again after pulling new migrations), then `npm run dev` from the repo root (Express on 3001, Vite on 5173, `/api` proxied).

### Listings

Leases and sublets share one `listings` table and these routes. A sublet is a listing with `kind: 'sublet'`. The response shape matches `ListingRecord` in `client/src/data/data.ts`.

| Method | Route           | Purpose |
| ------ | --------------- | ------- |
| GET    | `/listings`     | Search. Filters: `kind`, `type`, `neighbourhood`, `minPrice`, `maxPrice`, `furnished`, `from`/`to` (available for the whole period), `limit` (max 50), `offset`. Ended sublets are hidden. |
| GET    | `/listings/:id` | Get one listing |
| POST   | `/listings`     | Signed in: Sublets: students only, max 3 active. Leases: landlords/admins. |
| PATCH  | `/listings/:id` | Signed in: Poster or admin. Can't change `kind` or `westernVerified`. |
| DELETE | `/listings/:id` | Signed in: Poster or admin |
| GET    | `/me/listings`  | Signed in: Everything I've posted, including ended sublets |

- Sublets need `availableTo` after `availableFrom`. Leases have no end date.
- `westernVerified` can't be set by the poster. The server sets it when the private `streetAddress` matches Western's list (see Verification).
- `streetAddress` (optional, private): full address with the house number. Accepted on POST/PATCH, never returned.
- `landlordId` is the poster for leases and null for sublets. Sam: add the foreign key once the landlords table exists.
- Ratings (`rating`, `reviewCount`) will be added with the reviews endpoints.

### Reviews

| Method | Route                   | Purpose                               |
| ------ | ----------------------- | ------------------------------------- |
| GET    | `/listings/:id/reviews` | Get reviews and ratings for a listing |
| POST   | `/listings/:id/reviews` | Signed in: Post a review and rating           |
| DELETE | `/reviews/:id`          | Signed in: Author deletes their review        |

### Roommates & Matching

| Method | Route                      | Purpose                             |
| ------ | -------------------------- | ----------------------------------- |
| POST   | `/listings/:id/interest`   | Signed in: Mark interest in a listing       |
| DELETE | `/listings/:id/interest`   | Signed in: Remove interest                  |
| GET    | `/listings/:id/interested` | Signed in: See other students interested    |
| POST   | `/matches`                 | Signed in: Like a student (match if mutual) |
| GET    | `/matches`                 | Signed in: Get my matches                   |

### Groups

A group is one post on the Roommates board (`kind`: `have-place`, `need-place` or `group`). The response shape matches `RoommatePost` in `client/src/data/data.ts`, plus `memberIds` and `createdBy`.

| Method | Route               | Purpose                         |
| ------ | ------------------- | ------------------------------- |
| GET    | `/groups`           | List all groups, newest first (public). Full groups are included; the board hides them. |
| GET    | `/groups/:id`       | Get a group and its members (public) |
| POST   | `/groups`           | Signed in, students: Create a group. The poster is the first member. |
| POST   | `/groups/:id/join`  | Signed in, students: Take an open spot. 409 `group_full` / `already_member`. |
| POST   | `/groups/:id/leave` | Signed in, students: Give up your spot. The creator can't leave (403). |
| DELETE | `/groups/:id`       | Signed in: Creator or admin deletes the group |

- `listingId` is optional. If set, `spotsTotal` can't be more than the listing's beds.
- `haveCount` is how many people are already in, the poster included. Friends who aren't on the app (`haveCount - 1`) take up spots and show as "Housemate 1", "Housemate 2"…
- Frontend: the Roommates board shows API groups first, then the seed posts. API groups get a Join/Leave button; seed posts keep the Knock button.

### Verification (Western Verified)

A listing gets the Western Verified badge when its street address is also on Western's Off-Campus Housing site (https://offcampus.uwo.ca/listings/). Code: `server/src/verification/`.

| Method | Route                       | Purpose                                                                 |
| ------ | --------------------------- | ----------------------------------------------------------------------- |
| POST   | `/verification/scrape`      | Signed in, admin only: start a scrape. Returns 202 right away; it takes about a minute. 409 if one is running. |
| GET    | `/verification/runs`        | Signed in, admin only: the last 10 runs (status, pages, listings seen, how many of ours are verified, error). |

Or from the command line: `npm run scrape:western -w server` (needs `SCRAPER_CONTACT` in `server/.env`). Run it about once a day, not more.

How it works:
- **Scrape:** fetches page 1, then POSTs Western's search form with `PageNumber` = 1, 2, ... like clicking the page numbers (about 21 pages of 50). One request every 3 seconds, an honest User-Agent with our contact email, robots.txt checked first, and it stops if Western returns 429/503. It saves only what matching needs (address, area, price, bedrooms, date) in `western_listings`, not their descriptions or photos.
- **Match:** listings have a private `streetAddress` ("1066 Richmond St"), set from the optional "House number" field on the post form. It is never returned by the API; the public `address` still has no house number. Addresses are normalized (`St`/`Street`/`Streeet`, `E`/`East`, units dropped) and match on house number + street name; suffix and direction must agree when both sides have them. Intersections ("Regent & Harrison", about 1 in 6 Western ads) can't be tied to one house, so they never match.
- **Badges:** after a complete scrape (at least 90% of Western's own count), every listing's `westernVerified` is recomputed, so the badge comes off when the ad leaves Western's site. A partial or failed scrape adds what it saw but takes no badges away. Posting a listing, or PATCHing its `streetAddress`, checks it straight away against the last scrape.
- **If Western changes their page:** the scrape fails loudly ("Has the site changed?", "Asked for page 2 but got ...") instead of un-verifying everything. Update `server/src/verification/western.ts` and the saved page in `server/test/fixtures/western-page-1.html`.
- **Other sites** (rentals.ca, Kijiji, Facebook Marketplace, Craigslist, realtor.ca) forbid scraping in their terms. Only add one with written permission, as a new parser next to `western.ts`.
- **Before turning it on:** check Western's terms and robots.txt (the scraper obeys robots.txt automatically), and ideally email off-campus.housing@uwo.ca to say what we're doing.
