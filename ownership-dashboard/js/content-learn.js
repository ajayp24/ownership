/*
 * content-learn.js — educational content for the Learning modules.
 *
 * Legal statements summarise the SEC rules as amended by the 2023 beneficial
 * ownership modernization (Release No. 33-11253 / 34-98704, Oct 2023) and the
 * 2022 Form 13F amendments. They are a learning aid, not legal advice; each
 * section links to the SEC source so readers can check the current text.
 *
 * Examples marked "Real filing" come from the bundled SEC data and cite the
 * accession number. Examples marked "Illustrative" use invented names and no
 * real numbers.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});

  // Mini diagrams: nodes [id, label, kind], edges [from, to, label, relType]
  const CONCEPTS = [
    {
      id: 'filer', name: 'Filer', group: 'Core',
      definition: 'The person or entity in whose name a filing is submitted to EDGAR. Every filer has a Central Index Key (CIK), a permanent 10-digit SEC identifier. The filer is responsible for the content of the filing.',
      example: { kind: 'Real filing', text: 'Schedule 13G/A accession 0000102909-26-000630 (filed 26 Mar 2026) was filed by The Vanguard Group (CIK 0000102909) about Apple Inc. (CIK 0000320193). Vanguard is the filer; Apple is the issuer.' },
      role: 'Identifies who is making the disclosure. On a 13F the filer is the institutional investment manager; on a 13D/G it is the reporting person(s); on Forms 3/4/5 it is the insider.',
      relations: 'A filer may also be an issuer (Berkshire Hathaway and JPMorgan Chase both issue shares and file 13Fs as managers). A filer can report for several reporting persons in one joint filing.',
      forms: ['13F', '13D', '13G', 'FORM3', 'FORM4', 'FORM5'],
      diagram: { nodes: [['f', 'Filer (CIK)', 'manager'], ['d', 'Filing', 'category'], ['i', 'Issuer', 'issuer']], edges: [['f', 'd', 'submits', 'FILES_FOR'], ['d', 'i', 'is about', 'REPORTED_13F_HOLDING']] },
      qa: [
        ['Who submits SEC filings?', 'The filer, usually through a filing agent (a law firm or financial printer). The first 10 digits of an accession number identify the entity that transmitted the filing, which is often the agent, not the filer.'],
        ['Can the filer be different from the beneficial owner?', 'Yes. A 13F filer reports securities over which it has investment discretion, which are usually owned by clients and funds. A parent holding company can file a 13G covering shares held by its subsidiaries.'],
        ['Can an investment manager file on behalf of multiple funds?', 'Yes. A 13F covers every account over which the manager exercises investment discretion, including all of its funds. Affiliated managers can be listed as "Other Included Managers" in one report.'],
        ['Can multiple reporting persons appear in one filing?', 'Yes. Schedules 13D and 13G allow joint filings (with a joint filing agreement), and Forms 3/4/5 allow more than one reporting person when they report the same securities.'],
      ],
      misconceptions: ['"The filer owns the shares." Not necessarily — a 13F filer often owns none of the reported shares.', '"The accession number prefix is the filer\'s CIK." Often it is the filing agent\'s CIK.'],
    },
    {
      id: 'issuer', name: 'Issuer', group: 'Core',
      definition: 'The company that issued the security being reported. In Schedules 13D/G and Forms 3/4/5 the issuer is the subject company; in a Form 13F the information table lists many issuers, one per row, identified by name and CUSIP.',
      example: { kind: 'Real filing', text: 'Apple Inc. (CIK 0000320193, CUSIP 037833100) is the issuer in every Form 4 filed by an Apple director or officer, and in every Schedule 13G about Apple common stock.' },
      role: 'Defines whose securities are being disclosed. Ownership percentages in 13D/G are percentages of a class of the issuer\'s securities.',
      relations: 'The issuer is the target of holding, ownership and insider-role relationships. It is not the reporting person, except when a company reports holdings in another issuer.',
      forms: ['13D', '13G', 'FORM3', 'FORM4', 'FORM5', '13F'],
      diagram: { nodes: [['i', 'Issuer', 'issuer'], ['s', 'Common stock (CUSIP)', 'category'], ['o', 'Reporting person', 'beneficialOwner']], edges: [['i', 's', 'issues', 'FILES_FOR'], ['o', 's', 'reports holding', 'BENEFICIAL_OWNERSHIP']] },
      qa: [
        ['Is the issuer always the company whose shares are reported?', 'Yes for 13D/G and Forms 3/4/5. A Form 13F is filed by a manager and covers many issuers, so there is no single issuer.'],
        ['What is the difference between the issuer and the reporting person?', 'The issuer is the company whose securities are held; the reporting person is the person disclosing its holdings of those securities.'],
        ['How is the issuer identified?', 'By its CIK (permanent SEC identifier) and, for a class of securities, by CUSIP. Tickers can change and are not part of most filings; Forms 3/4/5 include the issuer\'s trading symbol.'],
      ],
      misconceptions: ['"The company files 13Gs about itself." 13Gs about Apple are filed by its large holders; they appear on Apple\'s EDGAR page because Apple is the subject company.', '"Ticker = issuer." One issuer can have several classes and tickers (e.g. GOOGL and GOOG).'],
    },
    {
      id: 'beneficial', name: 'Beneficial owner', group: 'Core',
      definition: 'Under Exchange Act Rule 13d-3, a beneficial owner is any person who, directly or indirectly, has or shares voting power (the power to vote or direct the voting) and/or investment power (the power to dispose or direct the disposition) over a security. A person is also treated as the beneficial owner of securities it has the right to acquire within 60 days.',
      example: { kind: 'Real filing', text: 'In Schedule 13D accession 0001140361-24-049960 (event date 18 Dec 2024), Walton Enterprises, LLC reported sole voting power over 3,606,663,095 Walmart shares but sole dispositive power over 3,002,673,393 — voting and investment power are measured separately.' },
      role: 'Determines who must file Schedules 13D/G and who counts as a 10% owner for Section 16. Each 13D/G cover page reports sole/shared voting power, sole/shared dispositive power, the aggregate amount and the percentage of class.',
      relations: 'Beneficial ownership can be held directly or through a trust, partnership or company. Several people can be beneficial owners of the same shares at once (shared power).',
      forms: ['13D', '13G', 'FORM3', 'FORM4', 'FORM5'],
      diagram: { nodes: [['p', 'Person', 'beneficialOwner'], ['t', 'Trust / LLC', 'entity'], ['i', 'Issuer shares', 'issuer']], edges: [['p', 'i', 'direct', 'DIRECT_OWNERSHIP'], ['p', 't', 'controls', 'CONTROLS'], ['t', 'i', 'record holder', 'INDIRECT_OWNERSHIP']] },
      qa: [
        ['What is direct ownership?', 'Shares held in the person\'s own name or in a brokerage account for that person.'],
        ['What is indirect ownership?', 'Shares held through another person or entity — a trust, a partnership, a company, or family members sharing the household — where the person keeps voting/investment power (13D/G) or a pecuniary interest (Section 16).'],
        ['What is beneficial ownership through voting power?', 'Having or sharing the power to vote, or to direct the voting of, the securities.'],
        ['What is beneficial ownership through investment (dispositive) power?', 'Having or sharing the power to sell or otherwise dispose of the securities, or to direct their disposition.'],
        ['Can multiple persons share beneficial ownership?', 'Yes. A trustee and a co-trustee, or a general partner and its managing member, can each be beneficial owners of the same shares. Their cover-page amounts overlap and must not be added.'],
        ['Can someone control shares without holding them directly?', 'Yes — through a controlled company, a trust where they are trustee, a voting agreement, or a general partner role.'],
      ],
      misconceptions: ['"Beneficial owner = economic owner." Under Rule 13d-3 it is about power (voting or investment), not who receives dividends.', '"Section 16 uses the same test." For reporting holdings on Forms 3/4/5, beneficial ownership generally means a pecuniary interest (Rule 16a-1(a)(2)); the Rule 13d-3 test decides who is a 10% owner.'],
    },
    {
      id: 'manager', name: 'Institutional investment manager', group: 'Core',
      definition: 'Under Section 13(f)(6), any person other than a natural person that invests in or trades securities for its own account, and any person (including a natural person) that exercises investment discretion over the account of another person. A manager with investment discretion over $100 million or more in Section 13(f) securities must file Form 13F.',
      example: { kind: 'Real filing', text: 'Berkshire Hathaway Inc.\'s 13F-HR for period 30 Jun 2026 (accession 0001193125-26-352200) lists 14 Other Included Managers, including GEICO Corp and "Buffett Warren E" — a natural person can be an included manager because he exercises investment discretion.' },
      role: 'Files Form 13F quarterly. Also often files Schedule 13G as a qualified institutional investor ("IA" investment adviser, or "HC" parent holding company).',
      relations: 'Manages funds and separate accounts; exercises investment discretion; may vote proxies (voting authority). The funds and clients, not the manager, usually own the shares economically.',
      forms: ['13F', '13G'],
      diagram: { nodes: [['m', 'Manager', 'manager'], ['a', 'Fund A', 'fund'], ['b', 'Fund B', 'fund'], ['i', 'Issuer', 'issuer']], edges: [['m', 'a', 'manages', 'MANAGES'], ['m', 'b', 'manages', 'MANAGES'], ['a', 'i', 'holds', 'INDIRECT_OWNERSHIP'], ['b', 'i', 'holds', 'INDIRECT_OWNERSHIP'], ['m', 'i', '13F: discretion', 'REPORTED_13F_HOLDING']] },
      qa: [
        ['What does investment discretion mean?', 'Under Section 3(a)(35), the authority to decide which securities are bought or sold for an account, or to make those decisions even if someone else is responsible for the account.'],
        ['Can a manager manage multiple funds?', 'Yes. One 13F covers all accounts and funds over which the manager exercises discretion.'],
        ['Does the investment manager own the securities?', 'Usually not. The securities typically belong to the funds and clients. The manager reports them because it controls the investment decisions.'],
        ['Manager vs fund vs beneficial owner?', 'The fund holds the assets; the manager makes the decisions (and often votes); the beneficial owner under Rule 13d-3 is whoever has voting or investment power — often the manager or its parent, sometimes the fund as well.'],
      ],
      misconceptions: ['"A 13F shows what the manager owns." It shows securities under its investment discretion at quarter end.', '"A 13F is a complete portfolio." Shorts, most bonds, cash and non-13(f) securities are excluded.'],
    },
    {
      id: 'fund', name: 'Fund', group: 'Core',
      definition: 'A pooled investment vehicle (for example a registered mutual fund or ETF, or a private fund such as a hedge fund) that holds securities for its investors. A fund usually acts through an investment adviser.',
      example: { kind: 'Illustrative', text: 'Example Growth Fund (illustrative) is advised by Example Advisers LLC. The fund\'s shares in an issuer appear in Example Advisers\' 13F, not in a 13F of the fund.' },
      role: 'Registered funds report portfolio holdings on their own forms (e.g. Form N-PORT), which this project does not cover. Funds rarely file 13F themselves because their adviser exercises the investment discretion.',
      relations: 'Managed by an adviser; may be organised as a limited partnership with a general partner; its investors are limited partners or shareholders.',
      forms: ['13F', '13G'],
      diagram: { nodes: [['m', 'Adviser', 'manager'], ['f', 'Fund', 'fund'], ['i', 'Issuer', 'issuer']], edges: [['m', 'f', 'manages', 'MANAGES'], ['f', 'i', 'holds', 'INDIRECT_OWNERSHIP']] },
      qa: [['Does each fund appear in a 13F?', 'No. The 13F is filed by the manager; it does not break holdings down by fund.']],
      misconceptions: ['"Fund name on a 13F" — a 13F names the manager and any Other Included Managers, not individual funds.'],
    },
    {
      id: 'reporting', name: 'Reporting person', group: 'Participants',
      definition: 'The person whose beneficial ownership is disclosed on a Schedule 13D/G cover page, or the insider (the "reporting owner") on Forms 3/4/5. Each reporting person has its own cover page with its own numbers.',
      example: { kind: 'Real filing', text: 'Schedule 13D accession 0001140361-24-049960 on Walmart lists several reporting persons, including Walton Enterprises, LLC (44.9%) and Walton Family Holdings Trust (7.52%), each on its own cover page.' },
      role: 'The unit of disclosure on 13D/G and Forms 3/4/5. The "Type of Reporting Person" code (IA, HC, IN, PN, CO, OO …) says what kind of person it is.',
      relations: 'May be the filer, a co-filer in a joint filing, a member of a group, or a controlling person of another reporting person.',
      forms: ['13D', '13G', 'FORM3', 'FORM4', 'FORM5'],
      diagram: { nodes: [['a', 'Reporting person A', 'beneficialOwner'], ['b', 'Reporting person B', 'beneficialOwner'], ['i', 'Issuer', 'issuer']], edges: [['a', 'b', 'joint filing', 'JOINT_FILER'], ['a', 'i', 'reports', 'BENEFICIAL_OWNERSHIP'], ['b', 'i', 'reports', 'BENEFICIAL_OWNERSHIP']] },
      qa: [['Can reporting persons\' amounts be added?', 'Not without care. In joint filings the same shares are often reported by every person who shares power over them.']],
      misconceptions: ['"Two cover pages = two separate blocks of shares." Often the same shares, counted under shared power.'],
    },
    {
      id: 'director', name: 'Director', group: 'Participants',
      definition: 'A member of the issuer\'s board of directors. Directors are Section 16 insiders: they file Form 3 on becoming a director, Form 4 for most changes, and Form 5 annually when required.',
      example: { kind: 'Real filing', text: 'See the Insiders tab of any company in this dashboard: each Form 4 states whether the reporting owner is a director, an officer, a 10% owner or other.' },
      role: 'Checked in the "Relationship of Reporting Person to Issuer" box on Forms 3/4/5.',
      relations: 'May also be an officer, a 10% owner, or connected to an entity (e.g. a fund) whose holdings are reported indirectly.',
      forms: ['FORM3', 'FORM4', 'FORM5'],
      diagram: { nodes: [['d', 'Director', 'insider'], ['i', 'Issuer', 'issuer']], edges: [['d', 'i', 'insider role', 'INSIDER_ROLE'], ['d', 'i', 'direct holding', 'DIRECT_OWNERSHIP']] },
      qa: [['Must a director own shares to file?', 'No. A Form 3 is required on becoming a director even if no securities are owned ("no securities beneficially owned").']],
      misconceptions: ['"Insider data lists every director." It lists people who filed in the period covered; directors with no reportable activity may not appear.'],
    },
    {
      id: 'officer', name: 'Executive officer', group: 'Participants',
      definition: 'For Section 16, an "officer" (Rule 16a-1(f)) is the issuer\'s president, principal financial officer, principal accounting officer (or controller), any vice-president in charge of a principal business unit, division or function, and any other person who performs a policy-making function.',
      example: { kind: 'Illustrative', text: 'A chief financial officer who receives a stock award reports it on Form 4 with transaction code A, and shares withheld for taxes with code F.' },
      role: 'Officers file Forms 3/4/5; the officer title is stated in the relationship box.',
      relations: 'Often holds shares directly and indirectly (e.g. through a family trust); may hold derivative securities such as restricted stock units and options.',
      forms: ['FORM3', 'FORM4', 'FORM5'],
      diagram: { nodes: [['o', 'Executive officer', 'insider'], ['t', 'Family trust', 'entity'], ['i', 'Issuer securities', 'issuer']], edges: [['o', 'i', 'direct', 'DIRECT_OWNERSHIP'], ['o', 't', 'trustee', 'CONTROLS'], ['t', 'i', 'indirect: by trust', 'INDIRECT_OWNERSHIP']] },
      qa: [['Is every "VP" an officer for Section 16?', 'No — only those in charge of a principal unit or function, or who perform policy-making functions.']],
      misconceptions: ['"Executive officer" in proxy statements and "officer" in Section 16 are close but defined in different rules.'],
    },
    {
      id: 'gp', name: 'General partner', group: 'Participants',
      definition: 'The partner that manages a limited partnership and has authority to act for it. A GP typically controls the partnership\'s investment and voting decisions.',
      example: { kind: 'Illustrative', text: 'Example Partners GP LLC is the general partner of Example Fund LP. Both, and the GP\'s managing member, may be reporting persons on one Schedule 13D because they share voting and investment power.' },
      role: 'Commonly appears as a reporting person (type "PN" or "OO") on 13D/G cover pages alongside the fund it controls.',
      relations: 'Controls the limited partnership; often affiliated with the investment manager.',
      forms: ['13D', '13G'],
      diagram: { nodes: [['gp', 'General partner', 'entity'], ['lp', 'Fund LP', 'fund'], ['i', 'Issuer', 'issuer']], edges: [['gp', 'lp', 'controls', 'CONTROLS'], ['lp', 'i', 'holds', 'BENEFICIAL_OWNERSHIP'], ['gp', 'i', 'shared power', 'VOTING_POWER']] },
      qa: [['Is the GP a beneficial owner?', 'Usually yes, because it shares voting and investment power over the partnership\'s securities.']],
      misconceptions: ['"The GP owns most of the fund." A GP may have a small economic interest but full control.'],
    },
    {
      id: 'lp', name: 'Limited partner', group: 'Participants',
      definition: 'An investor in a limited partnership whose liability is limited and who normally takes no part in management.',
      example: { kind: 'Illustrative', text: 'A pension plan invests as a limited partner in Example Fund LP. It has an economic interest in the fund but no power over the fund\'s votes or trades.' },
      role: 'Normally not a reporting person for the partnership\'s portfolio holdings, because it has no voting or investment power over them.',
      relations: 'Invests in the partnership; the GP manages it.',
      forms: [],
      diagram: { nodes: [['lp', 'Limited partner', 'entity'], ['f', 'Fund LP', 'fund'], ['gp', 'General partner', 'entity']], edges: [['lp', 'f', 'invests in', 'MANAGES'], ['gp', 'f', 'controls', 'CONTROLS']] },
      qa: [['Does an LP report the fund\'s stock positions?', 'Generally no, unless it has voting or investment power or other arrangements that give it beneficial ownership.']],
      misconceptions: ['"Economic exposure = beneficial ownership." Not under Rule 13d-3 without voting or investment power.'],
    },
    {
      id: 'parent', name: 'Parent company', group: 'Participants',
      definition: 'A company that controls one or more subsidiaries, usually by owning a majority of their voting securities.',
      example: { kind: 'Real filing', text: 'BlackRock, Inc. files 13Fs that include many subsidiary advisers as Other Included Managers; a parent holding company that files Schedule 13G uses type code "HC" and identifies the relevant subsidiaries in Item 7.' },
      role: 'Can report on Schedule 13G as a parent holding company or control person, and on Form 13F on behalf of subsidiaries.',
      relations: 'Controls subsidiaries; may be deemed a beneficial owner of securities its subsidiaries hold.',
      forms: ['13G', '13F', '13D'],
      diagram: { nodes: [['p', 'Parent holding co.', 'manager'], ['s', 'Subsidiary adviser', 'manager'], ['i', 'Issuer', 'issuer']], edges: [['p', 's', 'controls', 'CONTROLS'], ['s', 'i', 'investment discretion', 'REPORTED_13F_HOLDING'], ['p', 'i', 'files 13G (HC)', 'FILES_FOR']] },
      qa: [['Do parent and subsidiary both report the same shares?', 'They may. Check the Other Included Managers list on the 13F and Item 7 on the 13G before adding figures.']],
      misconceptions: ['"Different CIKs = different shares." Affiliates often report overlapping positions.'],
    },
    {
      id: 'subsidiary', name: 'Subsidiary', group: 'Participants',
      definition: 'A company controlled by another company (its parent).',
      example: { kind: 'Real filing', text: 'Schedule 13G/A accession 0000102909-26-000630 notes that after an internal realignment (12 Jan 2026), certain subsidiaries of The Vanguard Group report beneficial ownership separately; Vanguard Capital Management LLC now files its own 13F.' },
      role: 'May file its own 13F or 13G, or be included in its parent\'s.',
      relations: 'Controlled by a parent; may manage funds.',
      forms: ['13F', '13G'],
      diagram: { nodes: [['p', 'Parent', 'manager'], ['s', 'Subsidiary', 'manager']], edges: [['p', 's', 'controls', 'CONTROLS']] },
      qa: [['Why do figures jump when a group reorganises?', 'Reporting can move from the parent to subsidiaries (or back). The total under management may be unchanged even though one filer\'s reported number falls.']],
      misconceptions: ['"A drop in a parent\'s 13G means selling." It can be a change in who reports.'],
    },
    {
      id: 'controlling', name: 'Controlling person', group: 'Participants',
      definition: 'A person who directly or indirectly has the power to direct the management and policies of another person, through voting securities, by contract or otherwise.',
      example: { kind: 'Illustrative', text: 'The sole managing member of an LLC that holds 8% of an issuer is a controlling person of that LLC and is usually named as a reporting person on its Schedule 13D/G.' },
      role: 'Appears as a reporting person (often type "HC" or "IN"); its control is described in Items 2, 6 and 7.',
      relations: 'Controls an entity that holds or manages the securities.',
      forms: ['13D', '13G'],
      diagram: { nodes: [['c', 'Controlling person', 'beneficialOwner'], ['e', 'Holding entity', 'entity'], ['i', 'Issuer', 'issuer']], edges: [['c', 'e', 'controls', 'CONTROLS'], ['e', 'i', 'holds', 'BENEFICIAL_OWNERSHIP']] },
      qa: [['Is a controlling person always disclosed?', 'Only as far as the filings state it. This tool never infers an "ultimate owner" that the filings do not establish.']],
      misconceptions: ['"Largest holder = controlling person." Control depends on power and arrangements, not just size.'],
    },
    {
      id: 'custodian', name: 'Custodian', group: 'Participants',
      definition: 'A bank or broker that holds securities in safekeeping for clients. Most listed US shares are held of record by Cede & Co., the nominee of the Depository Trust Company (DTC).',
      example: { kind: 'Illustrative', text: 'A fund\'s shares are registered to its custodian\'s nominee. The custodian is the record holder; the fund and its adviser hold the voting and investment power.' },
      role: 'Usually not a reporting person, because a custodian acting only as such has no voting or investment power.',
      relations: 'Legal (record) owner only; acts on instructions.',
      forms: [],
      diagram: { nodes: [['c', 'Custodian / nominee', 'entity'], ['f', 'Fund', 'fund'], ['i', 'Issuer shares', 'issuer']], edges: [['c', 'i', 'record holder', 'FILES_FOR'], ['f', 'i', 'beneficial owner', 'BENEFICIAL_OWNERSHIP']] },
      qa: [['Is the record holder the beneficial owner?', 'Usually not. Record ownership (legal title) and beneficial ownership (power) are different.']],
      misconceptions: ['"Shareholder register = ownership list." The register mostly shows nominees such as Cede & Co.'],
    },
    {
      id: 'trustee', name: 'Trustee', group: 'Participants',
      definition: 'A person who holds legal title to trust property and manages it for the trust\'s beneficiaries.',
      example: { kind: 'Real filing', text: 'The Walmart Schedule 13D (accession 0001140361-24-049960) is signed by a family member "in her capacity as trustee" of a trust that is a reporting person.' },
      role: 'Often a beneficial owner under Rule 13d-3 if it has voting or investment power. Insiders report trust holdings on Forms 3/4/5 as indirect ownership ("By Trust").',
      relations: 'Controls the trust\'s votes and investments; beneficiaries have economic interest.',
      forms: ['13D', '13G', 'FORM4'],
      diagram: { nodes: [['t', 'Trustee', 'insider'], ['tr', 'Trust', 'entity'], ['i', 'Issuer', 'issuer']], edges: [['t', 'tr', 'manages', 'CONTROLS'], ['tr', 'i', 'holds', 'INDIRECT_OWNERSHIP']] },
      qa: [['Can trust shares be counted twice?', 'Yes, if both a trustee and the trust (or co-trustees) report them. Look for shared power and footnotes.']],
      misconceptions: ['"Trust holdings are not the insider\'s." They are usually reported as indirect holdings.'],
    },
  ];

  const COMPARISON_ROWS = [
    ['Primary role', 'Who it is', 'Typical form(s)', 'Owns the shares?', 'Votes the shares?'],
    ['Filer', 'Submits the filing (has a CIK)', 'All', 'Not necessarily', 'Not necessarily'],
    ['Issuer', 'Company whose securities are reported', '— (subject of 13D/G, 3/4/5)', 'No', 'No'],
    ['Reporting person', 'Person whose ownership is disclosed', '13D/G, 3/4/5', 'Has power and/or interest', 'If it has voting power'],
    ['Beneficial owner', 'Has or shares voting or investment power (Rule 13d-3)', '13D/G', 'Not necessarily legal title', 'Possibly'],
    ['Institutional investment manager', 'Exercises investment discretion over others\' accounts', '13F, often 13G', 'Usually no', 'Often (voting authority column)'],
    ['Fund', 'Pooled vehicle holding the securities', 'Rarely files 13F', 'Yes (its assets)', 'Usually through its adviser'],
    ['Director / officer', 'Section 16 insider', '3/4/5', 'Directly and/or indirectly', 'For own holdings'],
    ['General partner', 'Manages a limited partnership', '13D/G', 'Small or no economic interest', 'Usually yes'],
    ['Limited partner', 'Passive investor in a partnership', 'Usually none', 'Economic interest in the fund', 'No'],
    ['Parent company', 'Controls subsidiaries', '13F, 13G (HC)', 'Through subsidiaries', 'Through subsidiaries'],
    ['Custodian', 'Safekeeping, record holder', 'None', 'Legal title only', 'No (acts on instructions)'],
    ['Trustee', 'Holds legal title for beneficiaries', '13D/G, 3/4/5 (indirect)', 'Legal title', 'Usually yes'],
  ];

  const REL_CONCEPTS = [
    ['Legal ownership', 'Who holds title, usually a nominee (Cede & Co.) or custodian. Not disclosed in these filings.', 'FILES_FOR'],
    ['Beneficial ownership', 'Rule 13d-3 power to vote and/or dispose. Disclosed on 13D/G cover pages.', 'BENEFICIAL_OWNERSHIP'],
    ['Voting power', 'Power to vote or direct the vote. Sole or shared, on 13D/G; voting authority columns on 13F.', 'VOTING_POWER'],
    ['Investment discretion', 'Authority to decide what to buy or sell. The reason a manager files 13F.', 'REPORTED_13F_HOLDING'],
    ['Management relationship', 'An adviser manages a fund or account. Usually by contract; not shown as such in 13F rows.', 'MANAGES'],
    ['Reporting relationship', 'One filer reports for or alongside another (joint filing, other included manager).', 'JOINT_FILER'],
    ['Control relationship', 'Parent over subsidiary, GP over partnership, managing member over LLC.', 'CONTROLS'],
  ];

  // Relationship-model scenarios for the interactive diagrams (all illustrative)
  const SCENARIOS = [
    {
      id: 'manager-funds', title: 'Investment manager, funds and the issuer',
      text: 'An adviser manages two funds. The funds\' shares sit with a custodian (legal title). The adviser decides trades (investment discretion) and votes proxies (voting power), so it reports the combined position on its 13F. The adviser does not own the shares.',
      nodes: [['m', 'Example Advisers LLC\n(investment manager)', 'manager'], ['fa', 'Fund A', 'fund'], ['fb', 'Fund B', 'fund'], ['c', 'Custodian bank\n(nominee)', 'entity'], ['i', 'Issuer Inc.\ncommon stock', 'issuer'], ['inv', 'Fund investors', 'entity']],
      edges: [['m', 'fa', 'MANAGES', 'manages'], ['m', 'fb', 'MANAGES', 'manages'], ['fa', 'i', 'BENEFICIAL_OWNERSHIP', 'holds (assets of fund)'], ['fb', 'i', 'BENEFICIAL_OWNERSHIP', 'holds'], ['c', 'i', 'FILES_FOR', 'legal title (record)'], ['m', 'i', 'REPORTED_13F_HOLDING', 'investment discretion → 13F'], ['m', 'i', 'VOTING_POWER', 'votes proxies'], ['inv', 'fa', 'MANAGES', 'invest in']],
    },
    {
      id: 'parent-sub', title: 'Parent company and subsidiary',
      text: 'A parent holding company controls an advisory subsidiary that exercises discretion over shares of the issuer. The parent may file one 13G as "HC" for the group, while the subsidiary appears as an Other Included Manager on the parent\'s 13F.',
      nodes: [['p', 'Parent Holdings Inc.\n(parent, HC)', 'manager'], ['s', 'Subsidiary Advisers LLC', 'manager'], ['i', 'Issuer Inc.', 'issuer']],
      edges: [['p', 's', 'CONTROLS', 'controls'], ['s', 'i', 'REPORTED_13F_HOLDING', 'investment discretion'], ['p', 's', 'OTHER_INCLUDED_MANAGER', 'other included manager on 13F'], ['p', 'i', 'BENEFICIAL_OWNERSHIP', '13G (as parent holding co.)']],
    },
    {
      id: 'officer', title: 'Executive officer: direct and indirect ownership',
      text: 'An officer holds some shares directly and more through a family trust where she is trustee. Form 4 shows each on its own line: "D" for direct, "I" with the nature "By Trust" for indirect. Restricted stock units are derivative securities in Table II.',
      nodes: [['o', 'Executive officer', 'insider'], ['t', 'Family trust', 'entity'], ['sp', 'Spouse (same household)', 'entity'], ['i', 'Issuer Inc.', 'issuer']],
      edges: [['o', 'i', 'INSIDER_ROLE', 'officer of'], ['o', 'i', 'DIRECT_OWNERSHIP', 'direct (D)'], ['o', 't', 'CONTROLS', 'trustee of'], ['t', 'i', 'INDIRECT_OWNERSHIP', 'indirect (I): By Trust'], ['sp', 'i', 'INDIRECT_OWNERSHIP', 'indirect (I): By Spouse']],
    },
    {
      id: 'group', title: 'Joint 13D filing: GP, fund and managing member',
      text: 'A fund LP holds 8% of an issuer. Its general partner and the GP\'s managing member share voting and investment power, so all three are reporting persons on one Schedule 13D. Each cover page shows the same shares as shared power — they are one position, not three.',
      nodes: [['mm', 'Managing member\n(individual)', 'beneficialOwner'], ['gp', 'Fund GP LLC', 'beneficialOwner'], ['lp', 'Fund LP', 'beneficialOwner'], ['i', 'Issuer Inc.', 'issuer']],
      edges: [['mm', 'gp', 'CONTROLS', 'controls'], ['gp', 'lp', 'CONTROLS', 'general partner of'], ['lp', 'i', 'BENEFICIAL_OWNERSHIP', '8% (shared)'], ['gp', 'i', 'BENEFICIAL_OWNERSHIP', 'same 8% (shared)'], ['mm', 'i', 'BENEFICIAL_OWNERSHIP', 'same 8% (shared)'], ['lp', 'gp', 'JOINT_FILER', 'joint filing']],
    },
  ];

  // Filing types: each with sections of [heading, html]
  const FILINGS = [
    {
      id: '13D', title: 'Schedule 13D', family: '13D', purpose: 'Beneficial ownership report for a person or group that acquires more than 5% of a covered class and is not eligible (or chooses not) to use Schedule 13G.',
      sections: [
        ['Who files', 'Any person or group that becomes the beneficial owner of <strong>more than 5%</strong> of a class of voting equity securities registered under Section 12 of the Exchange Act (a "covered class") and does not qualify for Schedule 13G — typically activist investors, strategic buyers and controlling shareholders.'],
        ['Deadlines (as amended in 2023)', 'Initial filing within <strong>5 business days</strong> after crossing 5% (previously 10 days). Amendments within <strong>2 business days</strong> after a material change; acquiring or disposing of 1% or more of the class is deemed material. Since 18 December 2024 Schedules 13D and 13G must be filed in structured XML.'],
        ['Cover page (one per reporting person)', '<ol class="small"><li>Name of reporting person</li><li>Member of a group?</li><li>SEC use only</li><li>Source of funds</li><li>Legal proceedings disclosure</li><li>Citizenship or place of organisation</li><li><strong>Sole voting power</strong></li><li><strong>Shared voting power</strong></li><li><strong>Sole dispositive power</strong></li><li><strong>Shared dispositive power</strong></li><li><strong>Aggregate amount beneficially owned</strong></li><li>Aggregate excludes certain shares?</li><li><strong>Percent of class</strong></li><li>Type of reporting person (IN, CO, PN, IA, HC, OO …)</li></ol>'],
        ['Items', '<ol class="small"><li>Security and Issuer</li><li>Identity and Background</li><li>Source and Amount of Funds</li><li><strong>Purpose of Transaction</strong> — plans or proposals such as acquisitions, mergers, board changes, or changes to capitalisation or dividend policy</li><li>Interest in Securities of the Issuer (amounts, percentage, transactions in the last 60 days)</li><li><strong>Contracts, Arrangements, Understandings or Relationships</strong> with respect to the issuer\'s securities (voting agreements, derivatives, pledges)</li><li><strong>Material to be Filed as Exhibits</strong> (joint filing agreement, financing and voting agreements)</li></ol>'],
        ['Why it matters', 'Item 4 reveals intent. A 13D signals that the holder may seek to influence or control the issuer, which is why analysts watch new 13Ds and Item 4 amendments for activist campaigns and takeover activity.'],
        ['Limitations', 'Shows ownership on the event date only. Percentages are computed by the filer, usually from the issuer\'s latest reported shares outstanding. Joint filers\' amounts overlap.'],
      ],
      source: 'https://www.sec.gov/rules-regulations/2023/10/s7-06-22',
    },
    {
      id: '13G', title: 'Schedule 13G', family: '13G', purpose: 'A shorter beneficial ownership report for more-than-5% holders that do not seek to change or influence control of the issuer.',
      sections: [
        ['Not "a 13D by another name"', 'Schedule 13G is available only to specific categories of filers who meet eligibility conditions. It asks for less information (no Item 4 purpose disclosure) and has different deadlines. A filer who loses eligibility — for example by deciding to influence control — must switch to Schedule 13D.'],
        ['Who can use it', '<ul class="small"><li><strong>Qualified institutional investors</strong> (Rule 13d-1(b)): broker-dealers, banks, insurance companies, registered investment companies, investment advisers, employee benefit plans, parent holding companies/control persons, savings associations, church plans and certain non-US institutions, acquiring in the ordinary course of business without a control purpose.</li><li><strong>Passive investors</strong> (Rule 13d-1(c)): any person without a control purpose who beneficially owns <strong>less than 20%</strong> of the class.</li><li><strong>Exempt investors</strong> (Rule 13d-1(d)): persons above 5% who did not acquire their shares in a transaction covered by Section 13(d) — for example holders since before the IPO.</li></ul>'],
        ['Initial filing deadlines (2023 amendments)', '<ul class="small"><li>Qualified institutional and exempt investors: within <strong>45 days after the end of the calendar quarter</strong> in which the obligation arose.</li><li>Qualified institutional investors that exceed <strong>10%</strong>: within 5 business days after the end of the month in which they cross 10%.</li><li>Passive investors: within <strong>5 business days</strong> after crossing 5%.</li></ul>'],
        ['Amendment deadlines (2023 amendments)', '<ul class="small"><li>All 13G filers: within 45 days after the end of a calendar quarter in which a <strong>material change</strong> occurred.</li><li>Qualified institutional investors: also within 5 business days after the end of a month in which ownership exceeds 10% or then changes by more than 5% of the class.</li><li>Passive investors: also within 2 business days after exceeding 10% or a change of more than 5% of the class.</li></ul>'],
        ['What it contains', 'Cover pages with the same voting/dispositive power, aggregate and percent-of-class rows; Item 3 (type of filer for 13d-1(b)); Item 4 (ownership); Item 5 (ownership of 5% or less — used for "exit" amendments); Item 7 (identification of the subsidiary that acquired the security, for parent holding companies); Item 8 (members of a group); Item 10 (certification of no control purpose).'],
        ['Limitations', 'Thresholds are tested at specific times (quarter-end, month-end), so ownership between filings is not visible. Large managers can reorganise reporting between parent and subsidiaries, changing numbers without any trading.'],
      ],
      source: 'https://www.sec.gov/rules-regulations/2023/10/s7-06-22',
    },
    {
      id: 'FORM3', title: 'Form 3', family: 'FORM3', purpose: 'Initial statement of beneficial ownership by a Section 16 insider.',
      sections: [
        ['Who files', 'Directors, officers (Rule 16a-1(f)) and beneficial owners of more than 10% of a class of equity securities registered under Section 12.'],
        ['When', 'Within 10 days after becoming an insider; for a company registering its securities for the first time (for example at an IPO), no later than the effective date of the registration statement.'],
        ['Contents', 'Holdings at the time the person becomes an insider: Table I non-derivative securities (e.g. common stock) and Table II derivative securities (options, RSUs), each marked direct (D) or indirect (I) with the nature of indirect ownership. A Form 3 is required even when no securities are owned.'],
        ['Limitations', 'A one-time snapshot; later changes appear on Forms 4 and 5.'],
      ],
      source: 'https://www.sec.gov/files/forms-3-4-5.pdf',
    },
    {
      id: 'FORM4', title: 'Form 4', family: 'FORM4', purpose: 'Statement of changes in beneficial ownership by a Section 16 insider.',
      sections: [
        ['When', 'Before the end of the <strong>second business day</strong> after the transaction. Since February 2023, bona fide gifts (code G) must also be reported on Form 4 within two business days, and Form 4 includes a checkbox for transactions made under a Rule 10b5-1 trading plan.'],
        ['What it shows', 'Each transaction: date, transaction code, shares, price, acquired (A) or disposed (D), shares owned after the transaction, and direct (D) or indirect (I) ownership with its nature. Table I covers non-derivative securities; Table II covers derivative securities (options, RSUs, warrants) with exercise price, exercise/expiration dates and underlying shares.'],
        ['Direct vs indirect', 'Each line reports the holding after the transaction for one form of ownership. An insider with direct holdings and holdings "By Trust" has separate lines, each with its own "owned following" figure.'],
        ['Limitations', 'Reports transactions and post-transaction holdings per line; there is no percentage of class. Holdings in different lines and different filings must be combined carefully (by security, form of ownership and date).'],
      ],
      source: 'https://www.sec.gov/files/forms-3-4-5.pdf',
    },
    {
      id: 'FORM5', title: 'Form 5', family: 'FORM5', purpose: 'Annual statement of changes in beneficial ownership.',
      sections: [
        ['When', 'Within 45 days after the end of the issuer\'s fiscal year.'],
        ['What it reports', 'Transactions that were exempt from Form 4 or eligible for deferred reporting (for example small acquisitions under Rule 16a-6, code L), and any transactions or holdings that should have been reported earlier on Form 3 or Form 4 but were not.'],
        ['Difference from Forms 3 and 4', 'Form 3 is the initial snapshot; Form 4 reports most changes within two business days; Form 5 is an annual catch-up. If everything was already reported, no Form 5 is needed.'],
        ['Limitations', 'Can be filed long after the transactions it reports, so dates must be read from each transaction line, not the filing date.'],
      ],
      source: 'https://www.sec.gov/files/forms-3-4-5.pdf',
    },
    {
      id: '13F', title: 'Form 13F', family: '13F', purpose: 'Quarterly report of Section 13(f) securities held in accounts over which an institutional investment manager exercises investment discretion.',
      sections: [
        ['Who files', 'Institutional investment managers with investment discretion over Section 13(f) securities with an aggregate fair market value of <strong>$100 million or more</strong> on the last trading day of any month of a calendar year. They file for the December quarter of that year and the first three quarters of the next.'],
        ['When', 'Within <strong>45 days</strong> after the end of each calendar quarter, reporting positions as of the last day of the quarter.'],
        ['Reportable securities', 'Only securities on the SEC\'s quarterly <strong>Official List of Section 13(f) Securities</strong>: mainly US exchange-traded stocks, certain ETFs and closed-end funds, some convertible debt and exchange-traded options. Most bonds, open-end mutual funds, cash and short positions are not reportable.'],
        ['Information Table columns', '<ul class="small"><li><strong>Name of issuer</strong> and <strong>title of class</strong></li><li><strong>CUSIP</strong> (and an optional FIGI)</li><li><strong>Value</strong> — whole US dollars for filings from January 2023 (previously thousands)</li><li><strong>Shares or principal amount</strong>, with type SH or PRN, and Put/Call for options</li><li><strong>Investment discretion</strong>: SOLE, DFND (shared-defined, with an affiliate) or OTR (shared-other)</li><li><strong>Other managers</strong>: sequence numbers of Other Included Managers sharing discretion</li><li><strong>Voting authority</strong>: Sole, Shared, None</li></ul>'],
        ['Report types and amendments', 'A <em>13F Holdings Report</em> lists all holdings; a <em>13F Notice</em> says all holdings are reported by another manager; a <em>Combination Report</em> does both. An amendment (13F-HR/A) is either a <strong>restatement</strong> (replaces the report) or adds <strong>new holdings</strong>.'],
        ['Confidential treatment', 'A manager may request confidential treatment for specific positions (for example while building a position). Omitted positions are disclosed later in an amendment if the request is denied or expires. The cover page says when confidential information has been omitted.'],
        ['What 13F is not', '<ul class="small"><li>Not a complete record of the manager\'s investments (no shorts, most bonds, cash or non-13(f) securities; small positions may be omitted).</li><li>Not proof of beneficial or legal ownership — it reports investment discretion, and the shares usually belong to clients and funds.</li><li>Not real time: positions are as of quarter end and can be published up to 45 days later, or later still for confidential positions.</li><li>Not deduplicated: affiliated managers can report overlapping positions.</li></ul>'],
      ],
      source: 'https://www.sec.gov/rules-regulations/staff-guidance/division-investment-management-frequently-asked-questions/frequently-asked-questions-about-form-13f',
    },
  ];

  const COMPARISON = {
    cols: ['Feature', '13F', '13D', '13G', 'Form 3', 'Form 4', 'Form 5'],
    rows: [
      ['Primary purpose', 'Institutional holdings', 'Significant (>5%) ownership with purpose and plans', 'Eligible >5% ownership without control intent', 'Initial insider holdings', 'Insider changes', 'Annual / deferred insider changes'],
      ['Main reporting party', 'Institutional investment manager', 'Beneficial owner (person or group)', 'Eligible beneficial owner (QII, passive, exempt)', 'Director, officer, 10% owner', 'Director, officer, 10% owner', 'Director, officer, 10% owner'],
      ['Typical trigger', '≥ $100M in 13(f) securities; quarterly', 'Acquiring > 5% of a covered class', '> 5% of a covered class (eligible filers)', 'Becoming an insider', 'A transaction or change', 'Fiscal year end'],
      ['Deadline', '45 days after quarter end', '5 business days; amendments 2 business days', '45 days after quarter end (QII/exempt); 5 business days (passive)', '10 days after becoming insider', '2nd business day after transaction', '45 days after fiscal year end'],
      ['Main information', 'Holdings by CUSIP, value, shares, discretion, voting authority', 'Ownership, voting/dispositive power, purpose (Item 4), contracts (Item 6)', 'Ownership, voting/dispositive power, filer type', 'Holdings (direct/indirect)', 'Transactions and post-transaction holdings', 'Deferred, exempt or late transactions'],
      ['Percentage of class', 'No', 'Yes (filer-calculated)', 'Yes (filer-calculated)', 'No', 'No', 'No'],
      ['Shows ownership?', 'No — investment discretion', 'Yes — beneficial ownership (Rule 13d-3)', 'Yes — beneficial ownership (Rule 13d-3)', 'Yes — pecuniary interest basis', 'Yes — pecuniary interest basis', 'Yes — pecuniary interest basis'],
      ['Key limitation', 'Historical snapshot; excludes shorts and most bonds; overlaps between affiliates', 'Point-in-time; joint filers overlap', 'Threshold-based timing; reorganisations change who reports', 'One-time snapshot', 'No percentage; per-line holdings', 'Filed long after transactions'],
    ],
  };

  SOI.learn = { CONCEPTS, COMPARISON_ROWS, REL_CONCEPTS, SCENARIOS, FILINGS, COMPARISON };
})(typeof globalThis !== 'undefined' ? globalThis : this);
