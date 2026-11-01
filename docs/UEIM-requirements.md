# UEIM — Ultimate Entity & Investment Manager Master
## Complete Product Requirements, Initial Requirements, Functional Specification, Data Model and Master Coding-Agent Prompt

**Document type:** Product Requirements Document (PRD) + Technical Specification + Implementation Prompt  
**Project:** UEIM — Ultimate Entity & Investment Manager Master  
**Purpose:** Build an SEC filing ingestion, entity intelligence, ownership analysis and investment manager relationship platform.  
**Intended coding agents:** Claude Code, Cursor, GitHub Copilot Agent Mode and other AI development agents.

---

# PART 1 — ORIGINAL PROJECT REQUIREMENT

## 1.1 Project vision

Build a standalone web-based application called **UEIM (Ultimate Entity & Investment Manager Master)** that can ingest SEC filings, extract structured information, identify entities and their roles, and generate connected views of companies, filers, institutional investment managers, beneficial owners, insiders and securities.

The application should help users understand:

- Who files SEC reports?
- Which company is the issuer?
- Who reports ownership of a company's shares?
- Which investment manager reports positions in a company's securities?
- Who has beneficial ownership?
- Who has voting or dispositive authority?
- Which individuals are company insiders?
- Which funds, accounts or portfolios are associated with an investment manager, when documented?
- How are all these entities connected?
- What evidence supports each relationship?
- How has a reported position or ownership disclosure changed over time?

The system must not be limited to displaying filing documents. It must convert filing information into a structured, searchable, connected data platform.

## 1.2 Original functional requirement

The application must have two independently usable primary modules.

### Module A — Standalone SEC Filing Parser

Build a separate parser interface that can be opened and used without navigating through the main dashboard.

The user should be able to:

1. Upload an SEC filing document.
2. Upload multiple filing documents.
3. Upload a ZIP archive containing filing documents.
4. Select a filing type manually or allow automatic form detection.
5. Parse the document.
6. Extract filing metadata.
7. Identify entities and their roles.
8. Extract securities, holdings, ownership information or transactions.
9. Display the extracted information in structured tables.
10. Inspect the original filing evidence.
11. Export extracted information to JSON.
12. Export extracted information to Excel.
13. Export extracted information to CSV.
14. Save validated results into the UEIM database.
15. Reopen previously imported filing data.

The parser must not require the dashboard to be open.

### Module B — UEIM Intelligence Dashboard

Build a standalone HTML-based dashboard that uses the data extracted by the parser.

The dashboard should provide:

- Dashboard.
- Entity Master.
- Filer View.
- Ownership View.
- Investment Manager View.
- Issuer Filing View.
- Relationship Network.
- Filing Explorer.
- Position Explorer.
- Data Quality.
- Import History.

The dashboard must use a shared canonical data model. It must not create separate disconnected records for the same entity in different views.

## 1.3 Initial filing types

The parser should support these filing families:

| Filing | Primary purpose |
|---|---|
| 13F-HR | Institutional investment manager holdings report |
| 13F-HR/A | Amendment to a 13F filing |
| Schedule 13D | Beneficial ownership disclosure |
| Schedule 13D/A | Amendment to Schedule 13D |
| Schedule 13G | Eligible beneficial ownership disclosure |
| Schedule 13G/A | Amendment to Schedule 13G |
| Form 3 | Initial insider ownership statement |
| Form 4 | Insider ownership change / transaction |
| Form 5 | Annual insider ownership statement for applicable transactions |
| Form 10-K | Issuer annual report |
| Form 10-Q | Issuer quarterly report |
| Form 8-K | Issuer current report |
| DEF 14A | Issuer proxy statement |

Prioritize structured extraction for 13F, 13D/G and Forms 3/4/5. Initially, issuer forms can be indexed with metadata and SEC document links, with detailed extraction added progressively.

## 1.4 Initial issuer watchlist

Start with these ten companies:

1. Apple Inc.
2. Microsoft Corporation.
3. NVIDIA Corporation.
4. Amazon.com, Inc.
5. Alphabet Inc.
6. Meta Platforms, Inc.
7. Berkshire Hathaway Inc.
8. JPMorgan Chase & Co.
9. Tesla, Inc.
10. Walmart Inc.

These are the initial companies for exploration and testing. The application must support adding more issuers without code changes.

For each company, support:

- Entity profile.
- CIK.
- Issuer filings.
- Ownership View.
- Related institutional manager positions.
- Schedule 13D/G disclosures, where available.
- Insider Forms 3/4/5, where available.
- Historical filing information.
- Related entities and evidence.

Do not assume every company has every filing type.

## 1.5 Local storage and data persistence

The application should initially work locally in the browser.

Use:

- IndexedDB for structured filing and entity data.
- LocalStorage for lightweight preferences and UI settings.
- JSON for complete backup and restore.
- Excel and CSV for data exports.

Requirements:

- Imported data must survive browser refresh and restart.
- Duplicate imports must be detected.
- Amendments must be linked to original filings.
- Users must be able to export their data.
- Users must be able to restore a previous JSON backup.
- Uploaded documents must not be transmitted to external services by default.

Avoid using LocalStorage for large filing documents.

## 1.6 Standalone and future architecture

The first version should be usable as a standalone browser application.

However, design the architecture so that it can later evolve into:

- A React or Angular frontend.
- A .NET or Java backend.
- A relational database such as PostgreSQL.
- A background filing ingestion service.
- An SEC retrieval integration.
- An API-based multi-user platform.
- A cloud-hosted enterprise application.

Do not unnecessarily couple the business logic to the HTML page.

---

# PART 2 — IMPORTANT SEC DOMAIN CONCEPTS

## 2.1 Issuer

An **issuer** is the company or entity that issued a security.

Example: Apple Inc. is the issuer of Apple common stock.

An issuer generally files corporate and financial disclosures such as:

- Form 10-K.
- Form 10-Q.
- Form 8-K.
- DEF 14A.
- Applicable registration statements.
- Other filings depending on its circumstances.

**Important:** Apple does not normally file Form 13F merely because it issues publicly traded shares. Form 13F is generally filed by qualifying institutional investment managers reporting certain Section 13(f) securities over which they exercise investment discretion.

## 2.2 Filer

A **filer** is the entity or person identified as submitting a filing.

Depending on the filing type, the filer may be:

- An issuer.
- An institutional investment manager.
- A reporting person.
- An insider.
- Another person or entity acting in a defined filing capacity.

A filer is not automatically the beneficial or economic owner of the securities in a filing.

## 2.3 Reporting person

A **reporting person** is the person or entity whose reportable ownership information is disclosed in a filing.

Schedule 13D and 13G filings can include multiple reporting persons.

The platform must preserve each reporting person separately.

## 2.4 Institutional investment manager

An institutional investment manager may be required to file Form 13F if the applicable requirements are met.

A 13F filing generally reports certain Section 13(f) securities over which the manager exercises investment discretion.

Important limitations:

- A 13F is a periodic report, not a real-time portfolio.
- It does not cover every possible investment.
- It does not automatically establish beneficial or ultimate economic ownership.
- It may report aggregated positions.
- Its report period and filing date must be kept separate.

## 2.5 Beneficial owner

Schedule 13D and 13G disclose beneficial ownership under the applicable Section 13(d)/13(g) rules.

Beneficial ownership can involve voting power and/or investment/dispositive power.

Store these separately:

- Sole voting power.
- Shared voting power.
- Sole dispositive power.
- Shared dispositive power.
- Aggregate beneficial ownership.
- Percentage of class.
- Reporting person.
- Security class.
- Event date.
- Filing date.

Do not assume beneficial ownership always means ultimate economic ownership.

## 2.6 Insider

Forms 3, 4 and 5 relate to applicable Section 16 insider ownership and transactions.

- Form 3: initial statement.
- Form 4: changes and reportable transactions.
- Form 5: annual statement for transactions eligible or required to be reported there.

Store the insider's relationship with the issuer and the transaction-level information.

## 2.7 Fund, account and portfolio

An investment manager may manage funds, accounts or portfolios.

However:

- Do not assume every similarly named entity is a fund.
- Do not infer a fund relationship based on name similarity.
- A 13F filing may aggregate reportable holdings.
- A 13F filing does not necessarily reveal all underlying investors or economic owners.

Create these relationships only when supported by evidence.

---

# PART 3 — DIFFERENCE BETWEEN THE MAIN SEC FILING TYPES

| Filing type | What it reports | Main perspective |
|---|---|---|
| 13F-HR | Certain reportable institutional investment positions | Investment Manager / Filer |
| 13F-HR/A | Amendment to 13F | Investment Manager / Filer |
| 13D | Beneficial ownership disclosure | Reporting Person / Issuer |
| 13D/A | Amendment to 13D | Reporting Person / Issuer |
| 13G | Eligible beneficial ownership disclosure | Reporting Person / Issuer |
| 13G/A | Amendment to 13G | Reporting Person / Issuer |
| Form 3 | Initial insider ownership | Insider / Issuer |
| Form 4 | Insider transaction or ownership change | Insider / Issuer |
| Form 5 | Applicable annual insider disclosures | Insider / Issuer |
| 10-K | Annual corporate and financial disclosure | Issuer |
| 10-Q | Quarterly corporate and financial disclosure | Issuer |
| 8-K | Specified material current events | Issuer |
| DEF 14A | Proxy and shareholder voting information | Issuer |

Do not combine figures from these filing families into one ownership number without a valid methodology.

For example:

- A 13F position is not automatically beneficial ownership.
- A 13G disclosure is not the same as a 13F position.
- Form 4 transactions are not the same as institutional holdings.
- The same shares may appear in multiple reporting contexts.

---

# PART 4 — BLACKROCK AND APPLE EXAMPLE

Use BlackRock, Inc. and Apple Inc. as the first end-to-end demonstration.

## 4.1 Apple Inc.

Apple is an issuer.

The application should show:

- Apple Entity Profile.
- Apple Issuer Filing View.
- Apple Ownership View.
- Apple insider filings.
- External ownership disclosures about Apple.
- Institutional positions in Apple reported by investment managers.

Apple's own filings should include actual SEC filing records such as 10-K, 10-Q, 8-K and DEF 14A where available.

Apple should not be expected to have a normal 13F filing merely because it is an issuer.

## 4.2 BlackRock, Inc.

BlackRock can be represented as an institutional investment manager and filer where supported by the relevant filing.

Its profile should show:

- Entity identifiers.
- Filing history.
- 13F reports.
- Reported issuer positions.
- Relevant 13D/G filings, where applicable.
- Relationships supported by filings.
- Source evidence.

## 4.3 Apple Ownership View

Apple Ownership View should distinguish:

1. Institutional holdings reported through 13F.
2. Beneficial ownership disclosures reported through 13D/G.
3. Insider ownership and transactions reported through Forms 3/4/5.
4. Apple's own issuer filings.

A historical Apple Schedule 13G/A example previously discussed included an event date of December 31, 2023 and the following reported values:

- Aggregate beneficial ownership: 1,043,713,019 shares.
- Sole voting power: 936,902,208 shares.
- Shared voting power: 0.
- Sole dispositive power: 1,043,713,019 shares.
- Shared dispositive power: 0.

These values are historical example data only. Verify the exact SEC filing, reporting person, accession number, filing date and source document before importing them. Never display them as current ownership.

If the exact filing cannot be verified, do not seed these values.

---

# PART 5 — REQUIRED APPLICATION NAVIGATION

Create these main navigation modules:

1. Dashboard
2. Entity Master
3. Filer View
4. Ownership View
5. Investment Manager View
6. Issuer Filing View
7. Relationship Network
8. Filing Explorer
9. Position Explorer
10. SEC Filing Parser
11. Data Quality & Review
12. Import History
13. Settings

All modules must use the same canonical data.

## 5.1 Dashboard

Display:

- Total entities.
- Total issuers.
- Total investment managers.
- Total reporting persons.
- Total insiders.
- Total filings.
- 13F filings.
- 13D/G filings.
- Forms 3/4/5.
- Issuer filings.
- Positions extracted.
- Relationships identified.
- Unresolved entity matches.
- Latest ingestion activity.

Metrics must be calculated from actual stored records, not permanently hardcoded demo values.

## 5.2 Entity Master

Provide a searchable entity register.

Display:

- Legal name.
- Normalized name.
- Entity type.
- CIK.
- LEI.
- Ticker.
- Country/jurisdiction.
- Aliases.
- Roles.
- Related filings.
- Relationships.
- Evidence.
- Resolution status.

An entity may have multiple roles.

## 5.3 Filer View

Primary question:

**What has this filer or reporting entity reported?**

Example: BlackRock, Inc.

Show:

- Filer profile.
- Identifiers.
- Filing history.
- Filing counts by type.
- 13F issuer-wise holdings.
- 13D/G filings where applicable.
- Forms 3/4/5 where applicable.
- Related issuers.
- Historical positions.
- Source evidence.

## 5.4 Ownership View

Primary question:

**Who has reported ownership or ownership-related powers over this issuer's securities?**

Example: Apple Inc.

Show separate sections for:

- Institutional 13F positions.
- Schedule 13D/G beneficial ownership.
- Insider Forms 3/4/5.
- Direct and indirect ownership.
- Voting powers.
- Dispositive powers.
- Sole and shared ownership.
- Historical disclosures.
- Source filings.
- Filing dates and report periods.

Do not add all figures together to produce a misleading total.

## 5.5 Investment Manager View

Show:

- Manager profile.
- 13F filings.
- Reportable positions.
- Issuer-wise holdings.
- Historical holdings.
- Other reporting roles.
- Funds/accounts/portfolios only where documented.
- Relationships and evidence.

## 5.6 Issuer Filing View

Primary question:

**What has the issuer itself filed?**

For Apple, show:

- 10-K.
- 10-Q.
- 8-K.
- DEF 14A.
- Applicable registration statements.
- Other issuer filings.

External filings concerning Apple ownership should be linked separately, not treated as Apple's own filings.

## 5.7 Relationship Network

Build an interactive entity relationship graph.

Relationship types:

- Issuer.
- Filer.
- Reporting person.
- Institutional investment manager.
- Beneficial owner.
- Direct owner.
- Indirect owner.
- Voting authority.
- Dispositive authority.
- Parent.
- Subsidiary.
- Director.
- Officer.
- Fund.
- Account.
- Portfolio.
- Other documented relationships.

Every relationship must show:

- Source entity.
- Target entity.
- Relationship type.
- Effective date.
- Source filing.
- Evidence.
- Confidence.
- Confirmed or inferred status.
- Review status.

Confirmed, inferred and pending-review relationships must be visually distinct.

---

# PART 6 — CROSS-NAVIGATION REQUIREMENTS

## Journey A — BlackRock to Apple

1. Search BlackRock.
2. Open BlackRock Filer View.
3. Select an Apple position from a 13F filing.
4. Open Apple Entity Profile.
5. Open Apple Ownership View.
6. Inspect institutional holdings.
7. Inspect 13D/G disclosures.
8. Inspect insider disclosures.
9. Open the original filing evidence.
10. Navigate back to BlackRock.

## Journey B — Apple to BlackRock

1. Search Apple.
2. Open Apple Ownership View.
3. Find BlackRock in institutional holdings, where present.
4. Select BlackRock.
5. Open BlackRock Entity Profile.
6. Open Filer View.
7. Inspect the original filing and reported position.

## Journey C — Filing to entities

1. Open a filing by accession number.
2. Show the filer.
3. Show reporting persons.
4. Show issuer.
5. Show other relevant entities.
6. Show the role of each entity in the filing.
7. Allow navigation to each canonical entity.
8. Show evidence for every extracted role.

---

# PART 7 — CANONICAL DATA MODEL

Use a normalized data model. The physical database design can evolve, but the following logical entities are required.

## 7.1 Entity Master

Suggested fields:

- entityId
- legalName
- normalizedName
- entityType
- jurisdiction
- country
- cik
- lei
- ticker
- status
- createdAt
- updatedAt
- resolutionStatus
- primarySource

## 7.2 Entity Role Master

Suggested fields:

- entityRoleId
- entityId
- roleType
- validFrom
- validTo
- sourceFilingId
- evidenceId
- confidence
- status

Role types:

- ISSUER
- FILER
- REPORTING_PERSON
- INSTITUTIONAL_INVESTMENT_MANAGER
- BENEFICIAL_OWNER
- DIRECT_OWNER
- INDIRECT_OWNER
- INSIDER
- DIRECTOR
- OFFICER
- PARENT
- SUBSIDIARY
- FUND
- ACCOUNT
- PORTFOLIO
- FILING_AGENT

## 7.3 Entity Alias Master

Suggested fields:

- aliasId
- entityId
- aliasName
- normalizedAlias
- aliasType
- validFrom
- validTo
- source
- evidenceId
- confidence

## 7.4 Entity Relationship Master

Suggested fields:

- relationshipId
- fromEntityId
- toEntityId
- relationshipType
- relationshipSubType
- effectiveFrom
- effectiveTo
- sourceFilingId
- evidenceId
- confidence
- isInferred
- reviewStatus

## 7.5 Filing Master

Suggested fields:

- filingId
- accessionNumber
- formType
- filerEntityId
- filingDate
- eventDate
- reportPeriod
- issuerEntityId
- amendmentFlag
- originalFilingId
- filingDescription
- secUrl
- primaryDocumentUrl
- rawDocumentLocation
- parserName
- parserVersion
- ingestionStatus
- parserStatus

A filing may have multiple reporting persons and multiple filing-party roles. Do not force all filing relationships into a single filer/issuer pair.

## 7.6 Filing Party Master

Suggested fields:

- filingPartyId
- filingId
- entityId
- filingRole
- reportingPersonSequence
- sourceName
- evidenceId

## 7.7 Security Master

Suggested fields:

- securityId
- issuerEntityId
- cusip
- isin
- ticker
- securityTitle
- classTitle
- securityType
- exchange
- currency
- validFrom
- validTo
- source
- evidenceId

## 7.8 Ownership / Position Master

Suggested fields:

- positionId
- filingId
- reportingEntityId
- issuerEntityId
- securityId
- cusip
- securityTitle
- classTitle
- shares
- value
- valueUnit
- reportPeriod
- filingDate
- investmentDiscretion
- otherManager
- votingSole
- votingShared
- votingNone
- dispositiveSole
- dispositiveShared
- aggregateBeneficialOwnership
- percentOfClass
- directIndirect
- ownershipNature
- transactionCode
- transactionDate
- transactionShares
- transactionPrice
- sourceRowOrDocumentLocation
- evidenceId
- deduplicationKey

Not every field applies to every form. Use form-specific structures where necessary. Do not populate irrelevant fields with misleading zeros.

## 7.9 Evidence Master

Suggested fields:

- evidenceId
- sourceType
- sourceUrl
- accessionNumber
- documentName
- pageNumber
- sectionName
- tableName
- rowIdentifier
- textExcerpt
- rawValue
- normalizedValue
- extractionMethod
- parserVersion
- confidence
- capturedAt

## 7.10 Ingestion Run

Suggested fields:

- ingestionRunId
- sourceFileName
- sourceType
- formType
- startedAt
- completedAt
- status
- parserVersion
- recordsRead
- recordsCreated
- recordsUpdated
- recordsSkipped
- warnings
- errors
- sourceHash

---

# PART 8 — SEC FILING PARSER REQUIREMENTS

## 8.1 Independent parser module

The parser must work independently from the main dashboard.

It should support:

- Single document upload.
- Multiple document upload.
- ZIP archive upload.
- Form type auto-detection.
- Manual form selection.
- Validation.
- Structured extraction.
- Evidence inspection.
- JSON export.
- Excel export.
- CSV export.
- Saving to UEIM.

## 8.2 Supported input formats

Where available, support:

- XML.
- HTML.
- Inline XBRL / XBRL.
- TXT.
- CSV.
- ZIP.
- User-uploaded SEC documents.

## 8.3 Separate parser modules

Implement separate parsers:

- 13FParser
- Schedule13DParser
- Schedule13GParser
- Form3Parser
- Form4Parser
- Form5Parser
- IssuerFilingMetadataParser

Each parser must:

1. Detect/validate the filing type.
2. Extract filing metadata.
3. Extract relevant entities and roles.
4. Extract security information.
5. Extract positions, ownership powers or transactions.
6. Preserve raw values.
7. Normalize values.
8. Capture source evidence.
9. Return structured JSON.
10. Report errors and warnings.

## 8.4 Form 13F extraction

Extract:

- Manager name and CIK.
- Accession number.
- Filing date.
- Report period.
- Amendment status.
- Issuer.
- Title of class.
- CUSIP.
- Value.
- Shares/principal amount.
- Share/principal type.
- Investment discretion.
- Other manager information.
- Voting authority: sole, shared, none.

Preserve source values and units. Do not assume the filing's value field is already expressed in dollars without checking the applicable filing format.

## 8.5 Schedule 13D/G extraction

Extract:

- Issuer.
- Issuer CIK.
- Class of securities.
- CUSIP.
- Event date.
- Filing date.
- Reporting persons.
- Reporting-person type/category.
- Aggregate beneficial ownership.
- Percent of class.
- Sole voting power.
- Shared voting power.
- Sole dispositive power.
- Shared dispositive power.
- Relevant footnotes.
- Joint filing/group information, where applicable.
- Amendment sequence.

Preserve each reporting person separately. Do not sum overlapping reporting-person amounts.

## 8.6 Forms 3/4/5 extraction

Extract:

- Issuer.
- Reporting owner.
- Insider role.
- Security title.
- Transaction date.
- Transaction code.
- Transaction amount.
- Transaction price.
- Amount beneficially owned following transaction.
- Direct/indirect ownership.
- Nature of indirect ownership.
- Derivative security details.
- Footnotes.
- Filing date.
- Accession number.

Retain transaction-level data and history.

## 8.7 Issuer filing metadata extraction

For 10-K, 10-Q, 8-K and DEF 14A, extract or index:

- Issuer name.
- CIK.
- Form type.
- Filing date.
- Accession number.
- Primary document.
- Description/items, where available.
- Reporting period, where available.
- SEC source URL.

Do not claim detailed document analysis if only filing metadata has been indexed.

---

# PART 9 — ENTITY RESOLUTION AND DEDUPLICATION

Use an evidence-based entity resolution hierarchy:

1. Exact CIK.
2. Exact LEI.
3. Other authoritative identifiers.
4. Verified aliases.
5. Normalized legal name with jurisdiction and contextual evidence.
6. Manual review for ambiguous matches.

Rules:

- Never merge solely because names look similar.
- Preserve original names from source documents.
- Preserve aliases and former names.
- Support manual merge and split.
- Maintain audit history.
- Keep unresolved entities in a review queue.
- Distinguish companies from similarly named funds, subsidiaries, trusts and investment vehicles.

## 9.1 Position deduplication

Use filing identity, reporting entity, issuer, security, report period and position attributes.

Do not blindly add original and amended filing records.

An amendment must be linked to the original filing and processed according to its scope.

---

# PART 10 — OWNERSHIP AND POSITION RULES

These rules are mandatory:

1. A 13F position is not automatically beneficial ownership.
2. A 13D/G disclosure is distinct from a 13F position.
3. Forms 3/4/5 are separate insider disclosures.
4. Voting authority and dispositive authority are different.
5. Sole and shared powers must remain separate.
6. Direct and indirect ownership must remain separate.
7. Multiple reporting persons may have overlapping ownership.
8. Do not sum overlapping reporting persons.
9. Do not combine 13F and 13D/G figures into a single total without a valid methodology.
10. A percentage of class requires a reliable denominator and matching date/class basis.
11. Filing date, event date and report period must be separate fields.
12. Historical data must be labeled historical.
13. Amendments must be linked to original filings.
14. Unknown values must remain null, not zero.
15. Every displayed value must link to its source filing and evidence.

If estimated exposure or ownership calculations are added, label them as estimates, document the formula and disclose overlap and coverage limitations.

---

# PART 11 — TECHNICAL ARCHITECTURE

## 11.1 Initial technology

Preferred initial implementation:

- HTML5.
- CSS3.
- JavaScript ES6+.
- IndexedDB.
- LocalStorage for preferences only.
- Cytoscape.js for relationship graph.
- Chart.js for charts.
- SheetJS for Excel import/export.

Bundle libraries locally where practical so the app can run offline.

If CDNs are used, clearly disclose the internet dependency.

## 11.2 Logical modules

Separate responsibilities into:

- UI / Presentation.
- Entity Master.
- Entity Resolution.
- Filing Ingestion.
- Form-specific Parsers.
- Security Master.
- Position and Ownership Services.
- Relationship Service.
- Evidence Service.
- Search.
- Data Quality.
- Persistence.
- Import/Export.
- SEC Integration.

Even if the initial app is one HTML file, organize the JavaScript into clear modules/classes/functions.

## 11.3 Persistence

Use IndexedDB for:

- Entities.
- Aliases.
- Roles.
- Filings.
- Filing parties.
- Securities.
- Positions.
- Relationships.
- Evidence.
- Parser runs.
- Review decisions.

Provide:

- JSON backup.
- JSON restore.
- CSV export.
- Excel export.
- Duplicate import detection.
- Import progress.
- Error reporting.
- Confirmed reset workflow.

## 11.4 Optional SEC online integration

Use official SEC sources, including:

- EDGAR company filing pages.
- SEC submissions data.
- SEC filing archives.
- SEC structured data/XBRL resources where appropriate.

Respect SEC fair-access policies and request limits.

Make the User-Agent/contact configuration transparent.

Browser CORS restrictions may prevent direct browser-to-SEC requests. If necessary, provide a small local backend/proxy option or rely on user-uploaded documents. Do not claim a browser-only implementation bypasses CORS.

## 11.5 Security

- Treat uploads as untrusted input.
- Validate file type and size.
- Do not execute uploaded scripts.
- Sanitize displayed filing content.
- Avoid eval and unsafe dynamic code execution.
- Keep data local by default.
- Disclose all network requests.
- Do not send confidential uploads to third-party services without explicit consent.

---

# PART 12 — USER EXPERIENCE

Build a professional financial research interface.

Requirements:

- Responsive desktop-first layout.
- Clear navigation.
- Global search.
- Breadcrumbs.
- Filterable/sortable tables.
- Pagination or virtual scrolling for large datasets.
- Loading states.
- Empty states.
- Error states.
- Parser warnings.
- Clear distinction between reported, calculated, inferred and demo data.
- Visible filing date, event date and report period.
- Evidence drill-down.
- Accessible colors and typography.

Charts must identify:

- Source.
- Date basis.
- Units.
- Whether data is reported or calculated.

Do not overload the interface with unnecessary KPI cards.

---

# PART 13 — SEARCH AND ANALYTICS

Provide search by:

- Entity name.
- CIK.
- LEI.
- Ticker.
- CUSIP.
- Accession number.
- Form type.
- Filing date.
- Report period.
- Event date.
- Reporting person.
- Issuer.
- Filer.

Filters:

- Entity role.
- Relationship type.
- Original/amended filing.
- Parser status.
- Evidence status.
- Review status.

Historical comparisons must use comparable report periods and must account for amendments, security identifier changes and reporting coverage.

---

# PART 14 — AUDITABILITY

For every extracted record preserve:

- Accession number.
- SEC URL.
- Original raw value.
- Normalized value.
- Parser version.
- Extraction timestamp.
- Evidence location.
- Manual correction history.
- Reviewer.
- Amendment relationship.

Manual corrections must not overwrite source evidence.

Store corrected values separately with user, timestamp, reason and audit history.

---

# PART 15 — TESTING REQUIREMENTS

## 15.1 Parser tests

Test:

- Valid filing.
- Missing optional fields.
- Missing required fields.
- Multiple reporting persons.
- Multiple 13F information-table rows.
- Sole/shared voting power.
- Sole/shared dispositive power.
- Direct/indirect ownership.
- Amendments.
- Footnotes.
- XML namespaces.
- HTML table variations.
- Malformed documents.
- Duplicate uploads.
- Large documents.
- ZIP archives containing multiple filings.

## 15.2 Domain tests

Test:

- CIK matching.
- LEI matching.
- Alias matching.
- Ambiguous entity review.
- Manual merge/split.
- Relationship evidence.
- Amendment linkage.
- Position deduplication.
- No double-counting across reporting persons.
- No unsupported aggregation across filing types.
- Historical date handling.
- Null vs zero handling.

## 15.3 UI tests

Test:

- BlackRock to Apple navigation.
- Apple to BlackRock navigation.
- Filing to entity navigation.
- Upload and parse a filing.
- Inspect evidence.
- Export JSON.
- Export Excel.
- Export CSV.
- Refresh and verify persistence.
- Search by CIK and accession number.
- Approve an entity match.
- Inspect position evidence.

---

# PART 16 — IMPLEMENTATION PHASES

## Phase 1 — Foundation

Build:

- Application shell.
- Navigation.
- Dashboard.
- Entity Master.
- Entity Profile.
- IndexedDB.
- JSON backup and restore.
- Clearly labeled sample entities.

Acceptance: Application runs locally and data persists.

## Phase 2 — Independent parser

Build:

- Upload workflow.
- ZIP support.
- Form detection.
- 13F parser.
- 13D/G parser.
- Forms 3/4/5 parser.
- Normalized JSON.
- Evidence capture.
- CSV/Excel export.

Acceptance: Representative real SEC documents can be parsed and source evidence inspected.

## Phase 3 — Canonical entity and relationship model

Build:

- Entity Master.
- Alias Master.
- Entity Roles.
- Filing Parties.
- Entity Resolution.
- Relationship Master.
- Evidence Master.
- Review queue.

Acceptance: Shared entities are reused across all views.

## Phase 4 — Filer and issuer views

Build:

- Filer View.
- Ownership View.
- Issuer Filing View.
- Investment Manager View.
- Cross-navigation.

Acceptance: BlackRock and Apple can be explored using the same canonical records.

## Phase 5 — Ownership and position analysis

Build:

- 13F position analysis.
- 13D/G beneficial ownership analysis.
- Insider transaction analysis.
- Historical comparisons.
- Amendment handling.
- Deduplication.

Acceptance: No unsupported ownership totals or duplicate aggregation.

## Phase 6 — Relationship graph and data quality

Build:

- Cytoscape graph.
- Evidence drill-down.
- Confirmed/inferred/pending states.
- Data quality dashboard.
- Merge/split workflows.
- Audit history.

Acceptance: Every relationship can be traced to evidence.

## Phase 7 — SEC integration and scaling

Build:

- Optional SEC retrieval.
- Rate limiting.
- Request transparency.
- Large-file handling.
- Performance improvements.
- Expanded issuer universe.
- Parser coverage reporting.

Acceptance: Ingestion is repeatable, observable and reliable.

---

# PART 17 — CODING AGENT MASTER IMPLEMENTATION PROMPT

You are the senior software architect and full-stack developer responsible for implementing UEIM.

Your task is to build a working SEC filing intelligence platform using this document as the source of truth.

## Before implementation

1. Inspect the existing repository.
2. Identify the current technology stack.
3. Identify existing functionality and reusable components.
4. Do not overwrite working features unnecessarily.
5. Create an architecture document.
6. Define the canonical data model.
7. Define parser interfaces.
8. Define the first vertical slice.
9. Document assumptions.
10. Start implementation in manageable phases.

## Implementation requirements

- Build the standalone parser independently from the dashboard.
- Build the dashboard using the same canonical data model.
- Use separate form-specific parsers.
- Implement actual persistence.
- Implement real import/export.
- Implement search and filtering.
- Implement evidence drill-down.
- Implement cross-navigation.
- Implement tests.
- Implement error handling.
- Preserve raw filing data.
- Preserve source URLs and accession numbers.
- Never fabricate SEC information.
- Never silently discard unrecognized fields.
- Clearly label sample/demo records.
- Keep ambiguous entity matches for review.
- Never infer beneficial ownership from a 13F filing alone.
- Never assume Apple files 13F simply because it is an issuer.
- Never combine 13F, 13D/G and insider information into an unsupported ownership total.

## After each phase

Report:

1. Features implemented.
2. Files created or modified.
3. Architecture decisions.
4. Tests executed.
5. Test results.
6. Known limitations.
7. Exact instructions to run the application.
8. Next recommended phase.

Do not create only a static mockup and call it a completed product.

Implement actual functionality.

---

# PART 18 — DEFINITION OF DONE

The first production-quality milestone is complete when:

- [ ] Application runs locally with documented instructions.
- [ ] Independent SEC parser works.
- [ ] Multiple filing documents can be uploaded.
- [ ] ZIP archives can be processed.
- [ ] Filing type can be detected or selected.
- [ ] 13F parser works.
- [ ] 13D/G parser works.
- [ ] Forms 3/4/5 parser works.
- [ ] Issuer filing metadata can be indexed.
- [ ] Extracted data is available as JSON.
- [ ] CSV export works.
- [ ] Excel export works.
- [ ] Data persists in IndexedDB.
- [ ] JSON backup and restore work.
- [ ] Entity Master works.
- [ ] Filer View works.
- [ ] Ownership View works.
- [ ] Investment Manager View works.
- [ ] Issuer Filing View works.
- [ ] Relationship Network works.
- [ ] Filing Explorer works.
- [ ] Position Explorer works.
- [ ] BlackRock and Apple use shared canonical entities.
- [ ] Apple is not incorrectly expected to file 13F as an issuer.
- [ ] 13F positions are not mislabeled as beneficial ownership.
- [ ] 13D/G voting and dispositive powers are represented separately.
- [ ] Insider transactions remain separate.
- [ ] Amendments link to original filings.
- [ ] Duplicate positions are handled safely.
- [ ] Every important value links to source evidence.
- [ ] Ambiguous entity matches require review.
- [ ] Demo data is visibly labeled.
- [ ] Tests cover the core parsers and domain rules.
- [ ] SEC retrieval limitations are documented.

---

# PART 19 — FINAL ARCHITECTURAL PRINCIPLES

The following distinctions must remain intact throughout UEIM:

| Concept A | Concept B | Must remain distinct |
|---|---|---|
| Issuer | Filer | Yes |
| Filer | Reporting person | Yes |
| Investment manager | Beneficial owner | Yes |
| Investment discretion | Economic ownership | Yes |
| Voting power | Dispositive power | Yes |
| 13F position | 13D/G beneficial ownership | Yes |
| Insider filing | Institutional holdings filing | Yes |
| Issuer's own filing | External ownership filing | Yes |
| Confirmed relationship | Inferred relationship | Yes |
| Filing date | Event date | Yes |
| Filing date | Report period | Yes |

**Most important architectural principle:**

UEIM must be built around a shared canonical Entity Master, Entity Role Master, Relationship Master, Filing Master, Security Master, Position Master and Evidence Master.

Filer View, Ownership View, Investment Manager View, Issuer Filing View and Relationship View are different ways of exploring the same connected information.

The objective is not simply to parse SEC filings. The objective is to transform SEC filing information into a traceable, searchable and evidence-driven entity and ownership intelligence platform.

**Start by inspecting the repository and implementing Phase 1. Then proceed incrementally through the remaining phases.**
