-- UW-Madison course lookup database (SQLite)
-- Built by scripts/build_db.py; derived columns filled by scripts/analyze.py

PRAGMA foreign_keys = ON;

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE subjects (
  code    TEXT PRIMARY KEY,          -- UW numeric subject code, e.g. 266
  abbr    TEXT NOT NULL,             -- e.g. COMP SCI
  name    TEXT,                      -- e.g. COMPUTER SCIENCES
  college TEXT
);

CREATE TABLE courses (
  id               INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,   -- primary designation, e.g. COMP SCI 577
  subject_code     TEXT REFERENCES subjects(code),
  number           INTEGER NOT NULL,
  title            TEXT,
  description      TEXT,
  credits_min      REAL,
  credits_max      REAL,
  prereqs          TEXT,
  breadths         TEXT,                   -- JSON array, e.g. ["Humanities","Literature"]
  gen_ed           TEXT,                   -- Comm A / Comm B / QR-A / QR-B
  ethnic_studies   INTEGER DEFAULT 0,
  level            TEXT,                   -- Elementary / Intermediate / Advanced
  typically_offered TEXT,
  last_taught      INTEGER,                -- term code
  in_catalog       INTEGER DEFAULT 0,      -- present in the current term's catalog
  offered_now      INTEGER DEFAULT 0,      -- has sections this term
  enroll_course_id TEXT,
  madgrades_uuid   TEXT,
  source           TEXT,                   -- chat (peer-mentioned) or enrollment (large course this term)
  enrolled_now     INTEGER                 -- lecture enrollment this term, at build time
);

CREATE TABLE course_aliases (             -- every designation incl. cross-listings
  alias     TEXT PRIMARY KEY,             -- e.g. MATH 240
  course_id INTEGER NOT NULL REFERENCES courses(id)
);

-- Peer signal 1: anonymized WeChat group-chat counts (aggregate only)
CREATE TABLE chat_mentions (
  course_id INTEGER PRIMARY KEY REFERENCES courses(id),
  mentions  INTEGER NOT NULL,
  positive  INTEGER NOT NULL,
  negative  INTEGER NOT NULL,
  people    INTEGER,                      -- distinct people (newer extracts only)
  raw_codes TEXT                          -- seed codes merged into this row
);

-- Peer signal 2: public r/UWMadison threads (title + link only, no usernames)
CREATE TABLE reddit_threads (
  course_id INTEGER NOT NULL REFERENCES courses(id),
  post_id   TEXT NOT NULL,
  url       TEXT NOT NULL,
  title     TEXT NOT NULL,
  snippet   TEXT,
  year      INTEGER,                      -- estimated from the post id
  tone      INTEGER,                      -- -1 / 0 / +1 keyword tone of title+snippet
  PRIMARY KEY (course_id, post_id)
);

-- Historical grades (MadGrades, from UW public records)
CREATE TABLE grade_terms (
  course_id INTEGER NOT NULL REFERENCES courses(id),
  term      INTEGER NOT NULL,             -- e.g. 1264 = Spring 2026
  a INTEGER, ab INTEGER, b INTEGER, bc INTEGER, c INTEGER, d INTEGER, f INTEGER,
  s INTEGER, u INTEGER, cr INTEGER, n INTEGER, p INTEGER, i INTEGER, nw INTEGER, nr INTEGER, other INTEGER,
  total     INTEGER,
  PRIMARY KEY (course_id, term)
);

CREATE TABLE instructors (
  id   INTEGER PRIMARY KEY,               -- MadGrades instructor id
  name TEXT NOT NULL
);

CREATE TABLE section_grades (
  course_id     INTEGER NOT NULL REFERENCES courses(id),
  term          INTEGER NOT NULL,
  section       INTEGER NOT NULL,
  instructor_id INTEGER NOT NULL REFERENCES instructors(id),
  a INTEGER, ab INTEGER, b INTEGER, bc INTEGER, c INTEGER, d INTEGER, f INTEGER, total INTEGER,
  PRIMARY KEY (course_id, term, section, instructor_id)
);

-- Current-term sections (snapshot at build time)
CREATE TABLE current_sections (
  course_id   INTEGER NOT NULL REFERENCES courses(id),
  term        INTEGER NOT NULL,
  package_id  TEXT NOT NULL,
  type        TEXT,                       -- LEC / DIS / LAB / SEM
  section     TEXT,
  instructors TEXT,                       -- JSON array of names
  status      TEXT,                       -- OPEN / WAITLISTED / CLOSED
  enrolled    INTEGER,
  capacity    INTEGER,
  waitlist    INTEGER,
  PRIMARY KEY (course_id, package_id, type, section)
);

-- Derived stats (scripts/analyze.py)
CREATE TABLE course_stats (
  course_id     INTEGER PRIMARY KEY REFERENCES courses(id),
  graded        INTEGER,                  -- students with A-F grades, all terms
  gpa           REAL,
  gpa_recent    REAL,                     -- last 6 terms with data
  gpa_shrunk    REAL,                     -- empirical-Bayes GPA (small-n courses pulled to subject mean)
  pct_a         REAL,
  pct_b_up      REAL,                     -- A + AB + B
  pct_df        REAL,                     -- D + F
  trend         REAL,                     -- GPA change per year (weighted least squares)
  instr_spread  REAL,                     -- max - min instructor GPA (instructors with >= 30 graded)
  terms_count   INTEGER,
  first_term    INTEGER,
  last_term     INTEGER,
  reddit_count  INTEGER,
  reddit_tone   REAL
);

CREATE TABLE instructor_course_stats (
  course_id     INTEGER NOT NULL REFERENCES courses(id),
  instructor_id INTEGER NOT NULL REFERENCES instructors(id),
  graded        INTEGER,
  gpa           REAL,
  pct_a         REAL,
  terms         INTEGER,
  last_term     INTEGER,
  teaching_now  INTEGER DEFAULT 0,
  PRIMARY KEY (course_id, instructor_id)
);

CREATE INDEX ix_grade_terms_term ON grade_terms(term);
CREATE INDEX ix_section_grades_instr ON section_grades(instructor_id);
CREATE INDEX ix_reddit_course ON reddit_threads(course_id);

-- Convenience view: one row per course with everything a UI needs
CREATE VIEW v_courses AS
SELECT c.code, c.title, c.credits_min, c.credits_max, c.level, c.breadths, c.offered_now, c.source, c.enrolled_now,
       m.mentions, m.positive, m.negative,
       s.gpa, s.gpa_recent, s.pct_a, s.pct_df, s.trend, s.instr_spread, s.graded,
       s.reddit_count, s.reddit_tone
FROM courses c
LEFT JOIN chat_mentions m ON m.course_id = c.id
LEFT JOIN course_stats s ON s.course_id = c.id;
