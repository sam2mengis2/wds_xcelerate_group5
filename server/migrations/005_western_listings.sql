-- Western Verified: what we last saw on Western's Off-Campus Housing site (offcampus.uwo.ca/listings),
-- and the private street address we match it against.

-- Full address with the house number. Private: never returned by the API, only used for matching.
-- `address` stays "street and district, no house number" for display.
ALTER TABLE listings ADD COLUMN street_address TEXT;

-- One row per listing on Western's site. We keep only what matching needs, not their text or photos.
CREATE TABLE western_listings (
  western_id      INT PRIMARY KEY,                -- the id in /Listings/Details/<id>
  address         TEXT NOT NULL,                  -- as Western shows it: "49 Woodward Avenue" or "Regent & Harrison"
  area            TEXT NOT NULL,                  -- Western's area name, e.g. "Near South" (not our neighbourhoods)
  price           INT  NOT NULL CHECK (price >= 0),
  price_per_room  BOOLEAN NOT NULL,               -- "$850 per bdrm" vs "$850"
  plus_utilities  BOOLEAN NOT NULL,               -- "$850 + per bdrm": utilities extra
  bedrooms_vacant INT  NOT NULL CHECK (bedrooms_vacant >= 0),
  available_from  DATE,                           -- NULL = "Available Immediately"
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX western_listings_last_seen_idx ON western_listings (last_seen_at);

-- One row per scrape, so admins can see when it last ran and what happened.
CREATE TABLE verification_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT NOT NULL DEFAULT 'western',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  pages         INT NOT NULL DEFAULT 0,
  seen          INT NOT NULL DEFAULT 0,             -- Western listings parsed
  verified      INT NOT NULL DEFAULT 0,             -- our listings with the badge after the run
  error         TEXT
);
