# UW Course Lookup

Grade history, instructor-by-instructor GPA and this term's sections for **every course in the Fall 2026 catalog
(4,400+ UW–Madison courses)**, plus what students actually say about 290 of them.

👉 **[Open the tool](https://webgrs.github.io/uw-course-lookup/)**

![Course list](docs/light.png)

## What you can do with it

- **Search** by code, title or instructor. Shorthand like `cs 577` or `stats 240` works, and so do title words
  with a number (`calculus 234`) or an instructor (`calc feldman`).
- **Lenses** give one-click views: high GPA with a big class, big intro courses, courses where the
  instructor matters, grading getting harder or easier, open seats now, busy on Reddit.
- **Filter** by subject, level, breadth, minimum GPA or "offered this term", and **sort** 10 ways.
- **The grade band follows you.** The sticky A–F band at the top morphs into whichever course you hover
  or select, with tick marks showing the all-course split, so every row is compared at a glance.
- **Open a course** to see its grade distribution against the baseline, GPA by term since 2006, a dot plot
  of every instructor's GPA in that course (this term's instructors outlined), current sections and seats,
  and recent r/UWMadison threads. Step through courses with ← →.
- **Save courses** to get a running plan (total credits, credit-weighted GPA, breadths covered) and
  **compare** them side by side with overlaid GPA trends.
- **English / 中文** toggle, light and dark themes, keyboard navigation (`/`, `j`/`k`, `Enter`, `s`),
  and deep links (`#/c/COMP-SCI-577`, filters in the URL).

<details><summary>Course detail (dark theme)</summary>

![Course detail](docs/dark.png)

</details>

## What the data says

The **Insights** tab and [`docs/ANALYSIS.md`](docs/ANALYSIS.md) are generated from the database. Highlights:

- **Instructor beats course.** In MATH 320, MATH 340 and MATH 234, the most and least generous instructors
  are 1.4–1.7 GPA points apart. That is more than a full letter grade on the same syllabus.
- **Popularity says nothing about difficulty.** Chat mentions vs. GPA: Spearman ρ = −0.07 (p = 0.30).
- **Reddit tone does.** Courses whose r/UWMadison threads read upbeat really do grade higher
  (ρ = +0.43, p < 0.001, n = 220).
- **Grade inflation.** Weighted GPA across the 290 featured courses rose from 3.02 (Fall 2006) to 3.39
  (Spring 2026), and peaked in Spring 2020, the pandemic semester.

![Insights](docs/insights.png)

## How it works

```
GitHub Pages  ──►  index.html (no course data inside)
                        │  fetch /api/courses?q=…  /api/course/ID  /api/compare  /api/insights
                        ▼
Cloudflare Worker  ──  the whole dataset lives here, built locally and deployed with `wrangler`;
                       it is not in this repository
```

The page asks the API for one page of results at a time (60 rows), so the first load is two requests and about
30 KB. The Worker holds the data in memory, pre-sorts it once at start-up and answers a query in about 2 ms.

| Endpoint | Returns |
|---|---|
| `GET /api/meta` | counts, subjects, breadths, lens totals, campus grade split |
| `GET /api/courses` | one page of list rows: `q`, `sort`, `subj`, `lvl`, `br`, `gpa`, `now`, `lens`, `ids`, `offset`, `limit` (≤ 60) |
| `GET /api/course/:id` | the full record behind the course drawer |
| `GET /api/compare?ids=…` | up to 8 full records |
| `GET /api/insights` | the aggregate panels of the Insights tab |

Only the page is meant to call the API: requests must come from the site's origin, each client is rate-limited
per minute, and no endpoint returns the dataset in bulk. That raises the cost of copying everything; it cannot
make copying impossible, because anything the page can show, a patient scraper can read too.

## Data sources

| Source | What it gives | How |
|---|---|---|
| [MadGrades](https://madgrades.com) | Grade counts by term, section and instructor (UW public records) | public API |
| [Course Search & Enroll](https://public.enroll.wisc.edu) | Catalog, credits, breadths, prerequisites, this term's sections | public API |
| [r/UWMadison](https://www.reddit.com/r/UWMadison/) | Threads that name each course (title + link only) | web search via Firecrawl |
| Student group chat | How often each course came up, +/− tone | aggregate counts, never the messages |
| Rate My Professors | Not copied; each instructor links to an RMP search | link only |

## Run it yourself

```bash
python scripts/pipeline.py              # build data/uwcourses.db, analysis, worker/data.json, index.html
python scripts/pipeline.py --refresh    # also refresh this term's seats
node worker/dev-server.mjs              # page + API at http://127.0.0.1:8787/

python -m unittest discover -s tests    # parser, matcher, stats and database checks
cd worker && npm test                   # API engine and handler tests

cd worker && npx wrangler login         # once
python scripts/pipeline.py --deploy     # rebuild and deploy the API
```

Without a chat seed file (`courses.json`, kept private) the build still works and simply has no chat-sourced
tier. Python 3 uses the standard library only; the page is vanilla HTML/CSS/JS with hand-drawn SVG charts.
`site.config.json` holds the public API URL that `build_site.py` writes into `index.html`.
CI runs the tests on every push and fails if a private data file is ever committed.

```
courses.json  (private, chat counts)            scripts/extract_courses.py
   │
   ├─ build_db.py      match every code against the real catalog: drop non-courses,
   │                   merge cross-listings (CS 240 = MATH 240), add the term's largest
   │                   courses and every other catalog course, pull MadGrades history
   │                   + current sections                                       ─► data/uwcourses.db
   ├─ fetch_reddit.py  r/UWMadison threads per course                          ─► data/reddit.json
   ├─ analyze.py       GPA, trend, instructor spread, shrunk GPA, correlations ─► insights.json, ANALYSIS.md
   └─ build_site.py    export, withhold small counts, render the page           ─► worker/data.json, index.html
```

### A few details worth knowing

- **Three tiers.** `chat` (223 courses mentioned in student chat), `enrollment` (67 largest courses this term) and
  `catalog` (the other ~4,150: grades and seats, no peer signal). The first two drive the Insights tab. Catalog
  courses keep MadGrades history summed per term and instructor, which keeps the database near 28 MB.
  The first full build fetches ~14,000 API responses (about 20 minutes); later runs reuse the cache in `data/cache/`.
- **Catalog verification.** 26 of the 256 chat-extracted codes weren't real courses (for example,
  "comp sci 300" read as NUTR SCI 300) and are dropped.
- **Adjusted GPA.** "Highest GPA" ranks by an empirical-Bayes estimate that pulls small courses toward
  their subject's mean, and ignores courses with fewer than 50 graded students.
- **Trend.** Weighted least-squares slope of term GPA since Fall 2016, in GPA points per year.
- **Significance.** Correlations are Spearman ρ with a 2,000-shuffle permutation p-value.

## Privacy

The chat data never leaves the machine it was exported on, and neither does the per-course table built from it.
What the site publishes from the chat is limited to aggregates:

- a course mentioned fewer than three times shows no count and no tone (the page says "fewer than three");
- the Insights statistics are computed offline over all 223 courses and published only as summary numbers;
- the dataset itself (database, seed file, API data) is gitignored and lives only locally and in the cloud API.

Reddit data is limited to thread titles and links, with no usernames or comment text. Instructor grade data is
public record, republished by MadGrades.

## License

MIT
