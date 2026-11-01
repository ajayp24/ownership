# SEC Ownership Intelligence

Two standalone browser applications for understanding who **holds**, who **owns**, who **votes** and who **reports** the shares of US public companies, built directly from SEC filings.

| Application | File | What it does |
|---|---|---|
| **A. Ownership Intelligence Dashboard** | `ownership-dashboard/ownership-dashboard.html` | Learning modules (terminology, relationship models, filing types with a real 13F example), a step-by-step "One company, explained" walkthrough, 14 company pages (10 large + 4 small) with real SEC data, simple ownership map and relationship list, network graph, history charts, filing explorer, import of parsed filings |
| **B. SEC Filing Parser** | `sec-filing-parser/sec-filing-parser.html` | Upload 13F, 13D, 13G and Forms 3/4/5 (XML, HTML, TXT, CSV, ZIP) → normalized JSON, validation, local IndexedDB, JSON / Excel / CSV / ZIP export |

Everything runs in the browser. There is no backend and no paid API, and uploaded documents never leave the computer. Third-party libraries are bundled in `vendor/`, so no CDN is needed.

---

## 1. Running it

**Start here:** open **`index.html`** in the project folder. It links to both apps (single-file and source versions), suggests where to begin, and lists the companies.

### Option 1 — the single-file versions (simplest)
Open **`standalone/ownership-dashboard.html`** or **`standalone/sec-filing-parser.html`** by double-clicking. Each file is fully self-contained: all scripts, styles, libraries and (for the dashboard) the SEC data are inside it. No server, no internet and no other files are needed, so you can copy or email them on their own. Rebuild them after changing the source with `node tools/build-standalone.js`.

**Moving parsed filings to the dashboard is automatic:**
- In the dashboard, open **Imported data → Get filings from parser** (or the "Filing parser →" link). The parser opens linked to the dashboard, and every filing it has parsed is sent across.
- Or, in the parser, click **Send to dashboard** (top bar, on each parsed filing, or for the selected rows in "Local database"). This opens the dashboard if needed.
- With **Auto-send** ticked (the default), each newly parsed filing goes to the linked dashboard as soon as it is parsed.

The link exists only when one app was opened from the other. It uses `postMessage` between the two windows, so it works even when the browser gives each `file://` page its own storage. If you open the two files separately, use **Export JSON / Excel** in the parser and **Import** in the dashboard.

### Option 1b — the source files directly
`ownership-dashboard/ownership-dashboard.html` and `sec-filing-parser/sec-filing-parser.html` also open by double-click and behave the same way. They load their scripts from the neighbouring folders, so keep the folder structure intact.

### Option 2 — serve the folder locally (recommended)
```bash
cd sec-ownership-intelligence
python3 -m http.server 8765 --bind 127.0.0.1
```
Then open <http://localhost:8765/ownership-dashboard/ownership-dashboard.html>. Both apps now share one local database, so records you parse appear automatically on the dashboard under **Imported data**.

### Refreshing the SEC data (optional, needs internet)
```bash
SEC_USER_AGENT="Your Name your.email@example.com" node tools/fetch-sec-data.js
```
The SEC's fair-access policy requires a User-Agent with contact details. The tool stays well under 10 requests/second and caches every response in `tools/.cache/`. It writes `ownership-dashboard/data/sec-data.js` (and `.json`) and refreshes `sample-data/`. Node.js 18 or later is required.

### Tests
```bash
node --test tests/*.test.js
```
There are 29 tests covering the UEIM masters, every parser, the parser-to-dashboard link (two simulated windows) (with real SEC documents as fixtures), detection, entity resolution and the ownership engine. Expected values are cross-checked against the raw documents (row counts and summary-page totals), not typed in by hand.

---

### What to look at first
1. **Overview** — the large and small companies.
2. **One company, explained** (`#/explain/AAPL`) — picks one company and reads its real 13F, 13D/13G and Form 4 figures line by line in plain language. Switch to a small company (e.g. LWAY) to compare.
3. **SEC filing types → Form 13F** — a real Berkshire Hathaway 13F showing where the issuers are: the manager is the filer, and each information-table row is a different issuer (29 issuers in 89 rows).
4. A company page → **Visualise**: the *Ownership map* (issuer on top, three plain lists with bars) and *Who is connected to whom* (relationships as sentences). The full graph is one click away.

## 1b. UEIM — Entity & Investment Manager Master

`ueim/ueim.html` (single file: `standalone/ueim.html`) builds one canonical set of master tables from the same filings (`shared/ueim-masters.js`):

| Master | One row per | Notes |
|---|---|---|
| Entity Master | real-world entity | CIK-first; never merged on similar names; a name shared by two CIKs is not guessed. Entity **type** (what it is) is separate from **role** (what it does), and each type records its basis. |
| Role Master / Entity Roles | role / entity × role × context | Issuer, filer, reporting person, institutional investment manager, beneficial owner, direct/indirect owner, voting/dispositive authority, director, officer, 10% owner, parent, subsidiary, other included manager — with validity dates and source filings. |
| Relationship types / Relationship Master | edge | Corporate, investment, ownership, reporting, authority and insider categories; each type says whether it is ownership. Every edge has a source filing, dates, evidence text, confidence and a documented/inferred flag. |
| Filing / Security / Position Masters | accession / CUSIP / reported position | 13F rows summed per filing and CUSIP, 13D/G cover pages, Section 16 holdings. Undisclosed fields stay empty. |

Views: Dashboard (BlackRock and Apple, 12 questions answered from the filings), Entity Master, Filer View, Ownership View, Investment Manager View, Relationship Network (a folding hierarchy table — entity → category → relationship type → connected entities with figures and source filing — or a diagram where links pass through the documenting filing), Filing Explorer, Position Explorer, Data Quality, plus global entity search.

Demonstration data (`tools/build-ueim-data.js`, needs internet) — verified against the filings and covered by `tests/ueim.test.js`:
- BlackRock's Schedule 13G/A on Apple, accession 0001086364-24-006980, filed 12 Feb 2024, event date 31 Dec 2023: aggregate 1,043,713,019 shares (6.7%), sole voting 936,902,208, shared voting 0, sole dispositive 1,043,713,019, shared dispositive 0, type HC, Rule 13d-1(b), 22 subsidiaries in Exhibit A. Filed by CIK 0001364742 (then "BlackRock Inc.", now "BlackRock Finance, Inc.").
- BlackRock, Inc.'s full 13F-HR for 30 Jun 2026 (CIK 0002012383): 49,968 rows → 5,696 positions, reconciled to the summary page.
- EDGAR company records (name histories) for both BlackRock CIKs, Apple and BlackRock Advisors LLC.

Not established by these filings, so not created: legal title, individual funds/ETFs (needs Form N-PORT), LEI and tax identifiers, and how the two BlackRock CIKs relate to each other.

## 2. Project structure

```
sec-ownership-intelligence/
├── ownership-dashboard/
│   ├── ownership-dashboard.html
│   ├── css/dashboard.css
│   ├── js/  content-learn.js · diagrams.js · learn-views.js · company-views.js · network-view.js · explain-view.js · dashboard-app.js
│   └── data/sec-data.js(.json)        ← generated from SEC EDGAR by tools/fetch-sec-data.js
│       data/example-13f.js            ← generated by tools/build-13f-example.js (real Berkshire 13F)
├── sec-filing-parser/
│   ├── sec-filing-parser.html
│   ├── parsers/ parser-base.js · parser-13f.js · parser-13dg-common.js · parser-13d.js · parser-13g.js
│   │            parser-section16-common.js · parser-form3.js · parser-form4.js · parser-form5.js · index.js
│   ├── js/parser-app.js
│   └── css/parser.css
├── shared/  xml-lite.js · data-models.js · entity-resolution.js · relationship-engine.js
│            ownership-engine.js · ueim-masters.js · storage.js · bridge.js · ui-helpers.js · ui.css · load-node.js
├── sample-data/   real EDGAR documents (13F pair, 13D, 13G, legacy HTML 13G, Forms 3/4/5, full submission .txt)
├── tools/fetch-sec-data.js           optional SEC retrieval module (Node)
├── tools/build-13f-example.js       builds the 13F learning example from sample-data (offline)
├── ueim/                            UEIM app (ueim.html, js/ueim-app.js, data/ueim-data.js)
├── tools/build-ueim-data.js         builds the UEIM demonstration data from EDGAR
├── tools/build-standalone.js        packs each app into one self-contained HTML file in standalone/
├── standalone/                      ownership-dashboard.html · sec-filing-parser.html (single-file builds)
├── index.html                       start page linking to everything
├── tests/parsers.test.js
└── vendor/  cytoscape 3.28.1 · Chart.js 4.4.1 · SheetJS 0.18.5 · JSZip 3.10.1
```

Every module is a plain script that attaches to one `SOI` namespace and also exports for Node. The same parser code therefore runs in the browser, in the retrieval tool and in the tests, with no build step. Both HTML apps load scripts by relative path, so keep the folder structure intact.

---

## 3. The parser

**Common interface.** `SOI.parsers.parse(fileOrText, context?) → Promise<record>`, or call a specific class: `new SOI.Parser13F().parse(...)`, `Parser13D`, `Parser13G`, `ParserForm3`, `ParserForm4`, `ParserForm5`.

**Detection.** The detector reads:
- the XML root element and namespace (`informationTable`, `ownershipDocument` + `documentType`, `edgarSubmission` + `submissionType`);
- the EDGAR header (`CONFORMED SUBMISSION TYPE`) or the `<TYPE>` tag of a `.txt` submission;
- "SCHEDULE 13D/13G" text in legacy HTML;
- the CSV header.

When it is unsure, it rejects with `err.code === 'AMBIGUOUS'` and the UI asks you to choose the type.

| Input | Supported as |
|---|---|
| 13F `primary_doc.xml` + information table XML | Combined into one record when uploaded together or in one ZIP; either part alone also works |
| 13F information table CSV | Columns matched by name (`nameOfIssuer, cusip, value, sshPrnamt, …`); unknown columns kept as unmapped |
| Schedule 13D/13G structured XML (required from 18 Dec 2024) | Full cover pages for every reporting person, items, signatures |
| Legacy `SC 13D` / `SC 13G` HTML or TXT | Read with labelled-row heuristics; every value is flagged *heuristic, low confidence* |
| Forms 3/4/5 `ownershipDocument` XML | Tables I and II, footnotes, remarks, owner relationships |
| EDGAR full submission `.txt` | Split into its documents; accession number and filing date are taken from the SEC header |
| ZIP | Expanded in the browser; supported files inside are processed |

**What every parser does:**
- normalizes field names but keeps raw values;
- records the XML path of each value (`sourceRefs`, `sourcePath`);
- validates required fields and lists missing ones;
- reports errors without crashing;
- puts every XML field it did not map into `record.unmapped`, so nothing is silently dropped.

You can enter metadata that is not in a standalone XML file, such as the accession number or filing date, in the parser UI.

---

## 4. Normalized record (schema `soi.filing/1.0`)

```jsonc
{
  "schema": "soi.filing/1.0",
  "recordId": "0001193125-26-352200#13F#primary_doc.xml",
  "filing": { "formType", "formFamily", "isAmendment", "amendmentNumber", "amendmentType",
              "accessionNumber", "filingDate", "reportPeriod", "eventDate",
              "filerCik", "filerName", "sourceFile", "sourceUrl", "sourceFormat",
              "documentSchemaVersion", "parser", "parsedAt", "dataOrigin" },
  "issuer":   { "name", "cik", "ticker", "cusips": [] },
  "reportingPersons":   [ ... ],
  "investmentManagers": [ ... ],          // 13F: filing manager + other included managers
  "holdings":           [ ... ],          // 13F information-table rows (value, valueUSD, shares, discretion, votingAuthority, sourcePath)
  "ownershipRelationships": [ {
      "type": "BENEFICIAL_OWNERSHIP | DIRECT_OWNERSHIP | INDIRECT_OWNERSHIP | INSIDER_ROLE | JOINT_FILER | OTHER_INCLUDED_MANAGER | …",
      "from": { "name", "cik", "kind" }, "to": { ... },
      "shares", "percentOfClass", "percentBasis", "votingPower", "dispositivePower",
      "asOfDate", "dateBasis", "status": "reported | inferred", "confidence",
      "evidence": { "formType", "accessionNumber", "filingDate", "sourceUrl", "path", "note" } } ],
  "extension": { "type": "13F | 13DG | SECTION16", ... },   // form-specific detail
  "sourceRefs": { "issuer.cik": "primary_doc.xml:formData/coverPageHeader/issuerInfo/issuerCik" },
  "unmapped": [ { "path", "value" } ],
  "validation": { "status": "valid | warnings | errors", "errors": [], "warnings": [], "missing": [] }
}
```

Form-specific extensions:
- **13F**: report type, amendment info, summary page totals, other included managers, value unit (whole dollars from 3 Jan 2023, thousands before), confidential-treatment flags.
- **13DG**: schedule, rule relied on (13d-1(b)/(c)/(d)), event date, all cover-page figures per reporting person, item texts (Item 4 purpose, Item 6 contracts, Item 7 exhibits), heuristic flag.
- **SECTION16**: reporting owners and roles, non-derivative and derivative transactions and holdings, footnotes, the 10b5-1 flag, and Form 5 late-report flags.

For 13F filings, manager-to-issuer edges are not stored per row. The relationship engine derives one `REPORTED_13F_HOLDING` edge per manager × period × CUSIP, keeping every source row as evidence.

---

## 5. Ownership Intelligence Engine (`shared/ownership-engine.js`)

`SOI.ownership.buildIssuerView(records, issuer, { cusip, asOf })` returns separate institutional, beneficial and insider views, plus overlaps, data-quality findings, relationships and a concentration indicator.

Rules it enforces:
- **Three categories are never summed.** 13F (investment discretion), 13D/G (Rule 13d-3 voting or investment power) and Section 16 (pecuniary interest, per line) are shown side by side. No combined total is produced.
- **A 13F filer is not treated as an owner.** 13F edges are typed `REPORTED_13F_HOLDING` with `ownership: false`.
- **Percentages:**
  - 13D/G uses the filer's reported percentage.
  - 13F percentages are calculated only from a single-class `dei:EntityCommonStockSharesOutstanding` figure, labelled *calc*, with its date.
  - For multi-class issuers (Alphabet, Meta, Berkshire) no 13F percentage is calculated.
- **Share classes are not mixed.** 13F totals are per CUSIP. Options (underlying shares), debt (principal) and other classes are listed separately.
- **13F amendments:**
  - A *restatement* replaces the original; a *new holdings* amendment adds to it.
  - A "new holdings" amendment that repeats most of the original table is treated as a replacement to avoid double counting. This happens in the real data (JPMorgan Chase, 2025-09-30).
- **Duplicates.** One record is kept per accession number and form family. The bundled SEC copy wins over an imported copy.
- **Confidential treatment.** A quarter where the filer says positions were omitted, and that lists no position, is reported as "not comparable" rather than "exited". This happens in the real data (Norges Bank, 2025-09-30 and 2026-03-31).
- **Overlaps are reported with their basis and confidence:**
  - the same organisation in 13F and 13D/G (by CIK);
  - insiders who also file 13D/G;
  - indirect holdings through an entity that also files 13D/G;
  - possibly affiliated managers (name hint only, *inferred, low*);
  - other included managers who also file their own 13F;
  - joint 13D/G filers.
- **Entity resolution is conservative.**
  - CIK match means the same entity, and different CIKs are never merged.
  - Name-only records merge only when their normalized token sets are identical (e.g. "WALTON S ROBSON" = "S. Robson Walton").
- **Dates:** each figure keeps its own basis (13F reporting period, 13D/G event date, Form 4 transaction date). Filing dates are shown separately, and periods are never mixed silently.
- The engine never names an ultimate beneficial owner that the filings do not establish.

---

## 6. Bundled data (retrieved 1 Nov 2026 from SEC EDGAR)

- **10 large issuers:** AAPL, MSFT, NVDA, AMZN, GOOGL, META, BRK.B, JPM, TSLA, WMT.
- **4 small issuers**, chosen for contrasting ownership stories: Lifeway Foods (LWAY: family and activist Schedule 13D filings), Nathan's Famous (NATH: founder 13D), Clearfield (CLFD: institutional 13G holders), Build-A-Bear Workshop (BBW: many 13G filers). Their CUSIPs are taken from their own 13D/G filings, not typed in.
- Profiles come from `data.sec.gov/submissions`, and shares outstanding from the XBRL `companyconcept` API.
- **13F:**
  - The latest 4 reporting periods for 15 managers: Dimensional Fund Advisors, Renaissance Technologies (both common in small-company data), Vanguard Group, Vanguard Capital Management, BlackRock, State Street, FMR, Geode, Morgan Stanley, T. Rowe Price, Norges Bank, Bank of America, Goldman Sachs, Berkshire Hathaway, JPMorgan Chase — plus up to 8 more managers discovered as 13G filers.
  - Only rows for the CUSIPs of the 14 issuers are kept, and each record says so (`extension.holdingsFilter`).
  - CUSIPs were cross-checked against the issuer names the 13F filers used (`cusipCheck` in the data file).
- **13D/13G:** every structured-XML filing (Dec 2024 onwards) in each issuer's recent-filings list whose subject is the issuer. Filings *by* the company about other issuers are excluded.
- **Forms 3/4/5:** up to 8 / 30 / 6 of the most recent per issuer.
- **Totals:** 729 records from 22 managers, each with its accession number, filing date and EDGAR URL.

---

## 7. Known limitations

- **The institutional list is not every holder.** It covers only the managers above — for small companies especially, many smaller holders are missing. Add more by putting CIKs in `MANAGERS` in `tools/fetch-sec-data.js`, or by parsing and importing other 13Fs.
- **13F is historical and incomplete by design.** It reports quarter-end positions published up to 45 days later. It excludes shorts, most bonds and non-13(f) securities, small positions may be omitted, and confidential positions are missing.
- **Shares outstanding** is the issuer's latest cover-page figure. Its date usually differs from the 13F period, and the gap is shown when it exceeds 45 days.
  - The XBRL API returned no figure for Alphabet or Meta (multi-class).
  - Berkshire's undimensioned figure is from 2011 and is not used.
- **Legacy (pre-December 2024) 13D/G HTML/TXT** is parsed heuristically. Numbers are flagged and should be checked against the original. In the bundled Berkshire 13G on Apple, some subsidiaries' "percent of class" values were not found and are reported as missing.
- **Insider lists** contain only people who filed in the loaded window. They are not an official roster of directors and officers.
- **HTML renderings of Form 4 or 13F are not parsed.** Use the XML from the filing index.
- **Not covered:** Form N-PORT fund holdings, proxy-statement beneficial ownership tables, Form 144.
- **Rule summaries** reflect the 2023 Regulation 13D-G amendments and the 2022 Form 13F amendments. They are a learning aid, not legal advice. Each section links to the SEC source.
- **Storage:** IndexedDB data lives in one browser profile. Export it to back it up or to move it.

## 8. SEC sources
- EDGAR: <https://www.sec.gov/edgar>
- Submissions API: <https://data.sec.gov/submissions/>
- XBRL APIs: <https://data.sec.gov/api/xbrl/>
- Form 13F FAQ: <https://www.sec.gov/rules-regulations/staff-guidance/division-investment-management-frequently-asked-questions/frequently-asked-questions-about-form-13f>
- Beneficial ownership reporting amendments (2023): <https://www.sec.gov/rules-regulations/2023/10/s7-06-22>
- Forms 3, 4, 5 instructions: <https://www.sec.gov/files/forms-3-4-5.pdf>
- SEC fair-access policy: <https://www.sec.gov/os/accessing-edgar-data>
