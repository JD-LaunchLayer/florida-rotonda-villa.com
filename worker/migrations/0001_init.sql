-- Florida Rotonda Villa bookings.
-- A stay occupies nights from arrival (inclusive) to departure (exclusive).
-- The departure morning is free, so another guest may check in that day.
-- Pending and confirmed bookings hold nights. Expired, rejected, and cancelled do not.

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired', 'cancelled')),
  arrival TEXT NOT NULL,
  departure TEXT NOT NULL,
  guests INTEGER NOT NULL CHECK (guests BETWEEN 1 AND 6),
  extras_json TEXT NOT NULL,
  breakdown_json TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  rental_total INTEGER,
  extras_total INTEGER,
  cleaning_total INTEGER,
  total_to_pay INTEGER,
  deposit INTEGER,
  guest_first_name TEXT NOT NULL,
  guest_last_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_phone TEXT,
  message TEXT,
  terms_accepted INTEGER NOT NULL CHECK (terms_accepted = 1),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  balance_reminder_sent_at TEXT
);

CREATE INDEX idx_bookings_status_dates ON bookings (status, arrival, departure);
CREATE INDEX idx_bookings_pending_expiry ON bookings (status, expires_at);
CREATE INDEX idx_bookings_reminder ON bookings (status, arrival, balance_reminder_sent_at);

CREATE TABLE blocked_ranges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arrival TEXT NOT NULL,
  departure TEXT NOT NULL,
  reason TEXT NOT NULL
);

-- One row per occupied night. The primary key is the double-booking lock.
CREATE TABLE occupied_nights (
  night TEXT PRIMARY KEY,
  booking_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('booking', 'block'))
);

CREATE INDEX idx_occupied_booking ON occupied_nights (booking_id);

CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

-- Published block from data/availability.json: 1 Feb 2027 through 31 Mar 2027.
-- 1 Apr 2027 is a free check-in.
INSERT INTO blocked_ranges (arrival, departure, reason)
VALUES ('2027-02-01', '2027-04-01', 'Published owner block');

INSERT INTO occupied_nights (night, source)
WITH RECURSIVE nights(night) AS (
  SELECT '2027-02-01'
  UNION ALL
  SELECT date(night, '+1 day') FROM nights WHERE night < '2027-03-31'
)
SELECT night, 'block' FROM nights;
