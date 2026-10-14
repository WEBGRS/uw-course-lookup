-- Local dev copy of the tables the Worker needs (canonical: webgrs-guard/schema.sql)
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  site TEXT NOT NULL,
  ts INTEGER NOT NULL,          -- ms since epoch
  day TEXT NOT NULL,            -- UTC date, for quotas
  sid TEXT,                     -- session id from the signed token
  ip_h TEXT,                    -- salted hash of the client IP
  country TEXT,
  kind TEXT NOT NULL,           -- search / detail / ui / session ...
  item TEXT,                    -- the record asked for, when there is one
  q TEXT,                       -- compact JSON of the query
  status INTEGER,
  n INTEGER NOT NULL DEFAULT 1  -- records returned (quotas add these up)
);
CREATE INDEX IF NOT EXISTS ev_quota_sid ON events(site, day, kind, sid);
CREATE INDEX IF NOT EXISTS ev_quota_ip ON events(site, day, kind, ip_h);
CREATE INDEX IF NOT EXISTS ev_site_ts ON events(site, ts);
CREATE TABLE IF NOT EXISTS sessions (
  site TEXT NOT NULL,
  sid TEXT NOT NULL,
  ts INTEGER NOT NULL,
  ip_h TEXT,
  country TEXT,
  ua TEXT,
  human INTEGER,
  PRIMARY KEY (site, sid)
);
CREATE TABLE IF NOT EXISTS blocked (
  site TEXT NOT NULL,           -- a site name, or * for all
  key TEXT NOT NULL,            -- session id or IP hash
  kind TEXT NOT NULL,           -- sid / ip
  reason TEXT,
  ts INTEGER NOT NULL,
  PRIMARY KEY (site, key)
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course TEXT NOT NULL,
  instr TEXT,
  hours INTEGER,                -- bucket 0..4 of weekly hours outside class
  attend INTEGER,               -- 1 attendance required, 0 not
  tags TEXT,                    -- comma-separated grading parts
  text TEXT,
  dev_h TEXT NOT NULL,          -- hashed device id
  ip_h TEXT,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | ok | hidden
  UNIQUE (course, dev_h)
);
CREATE INDEX IF NOT EXISTS rv_course ON reviews(course, status);
CREATE INDEX IF NOT EXISTS rv_status ON reviews(status, ts);
CREATE TABLE IF NOT EXISTS review_asks (
  course TEXT NOT NULL,
  dev_h TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (course, dev_h)
);
