-- The usage receiver's tables (receiver/store.ts says how each is kept, docs/usage-receiver.md
-- what each count means). Days are UTC dates (YYYY-MM-DD); times are UTC, to the second.

-- The usage events den-kit sends (desktop/analytics.ts), as sent, with the day each happened
-- and when the receiver received it.
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  event TEXT NOT NULL,
  version TEXT NOT NULL,
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  at TEXT NOT NULL,
  day TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX events_day ON events (day);
CREATE INDEX events_install_day ON events (install_id, day);

-- Each install's first and last day with an event.
CREATE TABLE installs (
  install_id TEXT PRIMARY KEY,
  first_day TEXT NOT NULL,
  last_day TEXT NOT NULL
);
CREATE INDEX installs_first_day ON installs (first_day);
CREATE INDEX installs_last_day ON installs (last_day);

-- How many records the receiver took and skipped each day it received them.
CREATE TABLE intake (
  day TEXT PRIMARY KEY,
  records INTEGER NOT NULL,
  skipped INTEGER NOT NULL
);

-- Counts with no ID.
-- Installs that sent an event in a day, or in a week from Monday (start is that Monday), in all
-- (dimension 'all', value '') and by version, OS and CPU type.
CREATE TABLE active (
  period TEXT NOT NULL,
  start TEXT NOT NULL,
  dimension TEXT NOT NULL,
  value TEXT NOT NULL,
  installs INTEGER NOT NULL,
  PRIMARY KEY (period, start, dimension, value)
);

-- Each event's count in a day, and how many installs sent it.
CREATE TABLE event_counts (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  events INTEGER NOT NULL,
  installs INTEGER NOT NULL,
  PRIMARY KEY (day, event)
);

-- The installs whose first event was on a day (metric 'installs'); how many of them sent an
-- event on day 1, 7 and 30 after it ('day_1', 'day_7', 'day_30'); and how many sent each event
-- in their first 7 days, day 0 to day 6 (the event's name). A metric is there once its last day
-- has passed.
CREATE TABLE cohorts (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  installs INTEGER NOT NULL,
  PRIMARY KEY (day, metric)
);
