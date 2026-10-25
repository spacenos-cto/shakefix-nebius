# ShakeFix pitch statistics (researched 2026-10-12)

Rules: every VERIFIED row was read on the cited page/PDF itself (via fetch) in this session. Anything not confirmed on the source page is marked UNVERIFIED and excluded from the "Top 8". Quotes are short excerpts as returned from the source. No numbers are estimated.

Verification key: VERIFIED = read on source page. SECONDARY = read only on a reputable secondary page (primary blocked). UNVERIFIED = seen only in search snippets / vendor blogs, or primary not retrievable.

---

## A. Bug reporting reality

| Claim | Number | Source | Year | URL | Quote | Status |
|---|---|---|---|---|---|---|
| Non-reproducible bug reports share of all reports | 17% on average (32,124 of 188,319 reports across 6 repos) | Joorabchi, Mirzaaghaei, Mesbah, "Works For Me! Characterizing Non-reproducible Bug Reports", MSR 2014 (UBC) | 2014 | https://people.ece.ubc.ca/amesbah/resources/papers/mona-msr14.pdf | "non-reproducible bug reports pertain to 17% of all bug reports, remain active three months longer than their counterparts" | VERIFIED (PDF text) |
| Non-reproducible bugs that were later reproduced and fixed | 66% of Fixed NR reports | same | 2014 | same | "66% of Fixed non-reproducible reports were indeed reproduced and fixed" | VERIFIED |
| Cost of a requirements error found in operations vs. requirements phase | 29 to >1,500x | Stecklein et al., NASA, "Error Cost Escalation Through the Project Life Cycle" (INCOSE 2004). Caveat: requirements errors in large hardware/software systems (spacecraft, aircraft), not mobile apps | 2004 | https://ntrs.nasa.gov/citations/20100036670 | "at the operations phase, the cost to fix the requirements error ranged from 29 units to more than 1500 units" | VERIFIED |
| Same study, other phases | design 3-8x, build 7-16x, integration/test 21-78x | same | 2004 | same | "at the integration and test phase, the cost to fix the error becomes 21 - 78 units" | VERIFIED |
| Annual US cost of inadequate software testing | $59.5 billion (extrapolated); $22.2 billion avoidable with feasible improved testing | NIST Planning Report 02-4 (RTI), Tassey | 2002 | https://www.nist.gov/document/samate-document-greg-tasseys-summary-pdf-nists-2002-report-economic-impacts-inadequate | "Over half of software bugs are currently not found until \"downstream\" in the development process" | VERIFIED (PDF text). Old but government primary |
| Users who uninstall after ONE crash | 15.4% (1,000+ US app users) | Luciq (formerly Instabug) report | 2026 | https://www.martechcube.com/luciq-report-in-2026-mobile-users-expect-perfection/ | "15.4% of users uninstall an app after a single crash" | SECONDARY (BusinessWire original returned 403); vendor survey, self-reported |
| Users who say they would abandon apps over bugs | 88% | QualiTest Group with Google Consumer Surveys, 1,000+ US adults 18-54 | 2017 | https://appdevelopermagazine.com/Almost-all-users-abandon-apps-with-bugs-and-glitches/ | "88% of app users abandon apps due to finding bugs and glitches." | SECONDARY, vendor survey, hypothetical behavior |
| Share of unhappy users who report problems | 1 in 26 (Kolsky); 4% | Esteban Kolsky via blogs | n/a | n/a | n/a | UNVERIFIED - original not found, excluded |
| 65% uninstall after 3 crashes (Instabug Dec 2024); 60% (Embrace 2023); 80% give app 3 chances (Dimensional Research) | various | vendor | various | n/a | n/a | UNVERIFIED - only seen in search summaries |
| IBM "100x cost of production bug" | 100x | folklore | n/a | n/a | n/a | UNVERIFIED - no retrievable primary study; use NASA instead |
| GitClear/others on "silent churn" | - | - | - | - | - | No rigorous app-specific "never report bugs" stat found. Do not claim one. |

---

## B. Digital accessibility litigation and older adults

| Claim | Number | Source | Year | URL | Quote | Status |
|---|---|---|---|---|---|---|
| Federal website accessibility lawsuits | 3,117 in 2025 (up 27% from 2,452 in 2024) | Seyfarth Shaw, ADA Title III blog (Vu, Launey) | 2026 (covers 2025) | https://www.adatitleiii.com/2026/03/federal-court-website-accessibility-lawsuit-filings-bounce-back-in-2025/ | "Plaintiffs filed 3,117 website accessibility lawsuits in federal court in 2025." | VERIFIED |
| Share of all Title III suits that were website suits | 36% in 2025 (28% in 2024) | same | 2026 | same | "Website accessibility lawsuits accounted for 36% of the total number of ADA Title III lawsuits" | VERIFIED |
| Total ADA Title III federal filings | 8,667 in 2025 (8,800 in 2024) | Seyfarth via Mondaq/JD Supra | 2026 | https://www.mondaq.com/unitedstates/constitutional-administrative-law/1745806/ada-title-iii-federal-lawsuit-filings-fall-slightly-to-8667-in-2025 | headline "ADA Title III Federal Lawsuit Filings Fall Slightly To 8,667 In 2025" | SECONDARY (title/snippet; page not fetched) |
| HHS rule: WCAG 2.1 AA for web + mobile apps of recipients of HHS funding; compliance extended to May 11, 2027 (15+ employees), May 10, 2028 (<15) | dates | HHS OCR Section 504 final rule (2024) and interim final rule May 7, 2026, per Duane Morris | 2026 | https://www.duanemorris.com/alerts/health_human_services_follows_department_justices_lead_extends_section_504_web_mobile_0526.html | "The technical standard remains WCAG 2.1 Level AA." | SECONDARY (hhs.gov 403; Federal Register blocked). Verify scope: applies to recipients of HHS federal financial assistance, which may not cover a private pharmacy app unless it takes Medicare/Medicaid funds. |
| Adults 65+ with vision loss | 13.6 million (22.8%); 1.6 million (2.7%) blind/significant low vision | American Foundation for the Blind compilation of NHIS data (IPUMS NHIS v8.1) | 2024 data | https://afb.org/research-and-initiatives/statistics/older-vision-loss/estimates-nhis | "Vision loss" = trouble seeing even when wearing glasses or contact lenses | VERIFIED on page (AFB, derived from CDC NHIS; self-reported) |
| Global vision impairment, older people | "at least 2.2 billion people have a near or distance vision impairment"; "most people with vision impairment and blindness are over the age of 50 years" | WHO fact sheet | current | https://www.who.int/news-room/fact-sheets/detail/blindness-and-visual-impairment | as quoted | VERIFIED |
| Typical settlement $10,000-$75,000 | range | ABA Journal citing Wall Street Journal | 2016 | https://www.abajournal.com/news/article/law_firms_files_dozens_of_ada_suits_claiming_websites_arent_accessible_to_t | "The suits often settle quickly for between $10,000 and $75,000" | VERIFIED on page, but 2016 and secondhand. Weak; use cautiously |
| Settlement $5k-$20k / $5k-$25k | range | Accessible.org, TestParty (vendor blogs) | 2026 | n/a | n/a | UNVERIFIED (vendors who sell remediation, conflicting numbers) - excluded |
| Share of older adults using assistive tech / screen readers | - | - | - | - | - | NOT FOUND from a primary source. Do not claim. |

---

## C. Health-data privacy enforcement

| Claim | Number | Source | Year | URL | Quote | Status |
|---|---|---|---|---|---|---|
| GoodRx civil penalty; broke "never share" promise; FTC first-ever Health Breach Notification Rule action | $1.5 million | FTC press release | 2023 (Feb) | https://www.ftc.gov/news-events/news/press-releases/2023/02/ftc-enforcement-action-bar-goodrx-sharing-consumers-sensitive-health-info-advertising | "has agreed to pay a $1.5 million civil penalty for violating the rule"; "deceptively promised its users that it would never share personal health information with advertisers or other third parties" | VERIFIED |
| BetterHelp: refunds to consumers; promised limited use of health data, shared with Facebook, Snapchat, Criteo, Pinterest | $7.8 million | FTC press release | 2023 (Mar) | https://www.ftc.gov/news-events/news/press-releases/2023/03/ftc-ban-betterhelp-revealing-consumers-data-including-sensitive-mental-health-information-facebook | "pay $7.8 million to consumers" | VERIFIED |
| Premom (Easy Healthcare): "repeatedly and deceptively promised" not to share health info without consent | $100,000 civil penalty to FTC (plus $100,000 to DC, CT, OR AGs per secondary reports) | FTC | 2023 (May) | https://www.ftc.gov/node/81003 | "will pay a $100,000 civil penalty for violating the Health Breach Notification Rule" | VERIFIED (FTC); the $100k state payment is from secondary reporting (HIPAA Journal/search), UNVERIFIED |
| FTC finalized HBNR changes to cover health apps not under HIPAA | rule scope | FTC | 2024 (Apr) | https://www.ftc.gov/news-events/news/press-releases/2024/04/ftc-finalizes-changes-health-breach-notification-rule | "Final rule underscores its application to health apps and similar technologies not covered by HIPAA" | VERIFIED |
| Washington My Health My Data Act: violations enforceable by private action via Consumer Protection Act | no fixed statutory damages | WA Attorney General FAQ; RCW 19.373.090 | current | https://www.atg.wa.gov/protecting-washingtonians-personal-health-data-and-privacy ; https://app.leg.wa.gov/rcw/default.aspx?cite=19.373.090 | "any violation of the Act is a per se violation of the Washington Consumer Protection Act (CPA), RCW 19.86" ... "enforced by the Attorney General as well as through private action" | VERIFIED. Be precise: damages come from CPA RCW 19.86.090 (actual damages, court may treble up to $25,000 cap), https://app.leg.wa.gov/rcw/default.aspx?cite=19.86.090 - "may not exceed twenty-five thousand dollars" (VERIFIED for that cap on the increased award). Do NOT say MHMDA has a per-person statutory amount. |
| CCPA statutory damages | $100-$750 per consumer per incident, ONLY for data breaches (unencrypted personal info exposed due to failure of reasonable security) | Cal. Civ. Code 1798.150 via FindLaw; CA AG FAQ | current | https://codes.findlaw.com/ca/civil-code/civ-sect-1798-150/ ; https://oag.ca.gov/privacy/ccpa | "not less than one hundred dollars ($100) and not greater than seven hundred and fifty ($750) per consumer per incident" | VERIFIED (FindLaw statute text). Scope is breaches, NOT ignored opt-outs; opt-out violations are AG/CPPA enforcement only. Do not apply it to the CareRx opt-out bug. |

---

## D. Billing double-charge

| Claim | Number | Source | Year | URL | Quote | Status |
|---|---|---|---|---|---|---|
| Bank of America duplicate-fee class action settlement (ATM balance-inquiry fees charged twice at 7-Eleven) | $2.25 million | Yahoo Finance report; Schertzer v. Bank of America | 2026 (May 20) | https://finance.yahoo.com/markets/stocks/articles/bank-america-2-25m-atm-142035765.html | "agreed to pay $2.25 million"; "duplicate out-of-network fees for balance inquiries" | VERIFIED on page (news report, not court docket) |
| Symantec double-billing class settlement | ~$10M, 130,000+ customers | Law360 | 2013 | https://law360.com/articles/430254 | n/a | UNVERIFIED (snippet only, paywalled) |
| TD Bank Canada $15.9M, Scotiabank $10.45M duplicate fees | - | news | 2024/2026 | n/a | n/a | UNVERIFIED and Canadian - excluded |
| FTC online-lender case: charged twice in a month | $3.85M | Goodwin summary | 2019 | https://www.goodwinlaw.com/en/insights/blogs/2019/04/ftc-announces-385-million-settlement-with-online-lender | n/a | UNVERIFIED (snippet only) |
| CFPB/FTC aggregate stats on duplicate charges | - | - | - | - | - | NOT FOUND. Do not claim. |

---

## E. Medication errors

| Claim | Number | Source | Year | URL | Quote | Status |
|---|---|---|---|---|---|---|
| ISMP lists the microgram symbol as error-prone: mistaken as mg; use "mcg" | n/a (list entry) | ISMP List of Error-Prone Abbreviations, Symbols, and Dose Designations (ECRI-hosted PDF) | list dated 2021 (metadata) | https://online.ecri.org/hubfs/ISMP/Resources/ISMP_ErrorProneAbbreviation_List.pdf | Table row: "µg | Microgram | Mistaken as mg | Use mcg"; also "Ng or ng | Nanogram | Mistaken as mg | Use nanogram" | VERIFIED (PDF text) |
| 1000-fold overdose risk when mcg/µg read as mg | 1000x (arithmetic: 1 mg = 1,000 mcg) | FDA animal vet page via search; ISMP Canada | - | n/a | n/a | Arithmetic is certain; specific FDA/ISMP Canada wording UNVERIFIED |
| Adverse drug events: emergency visits and hospitalizations per year | >1.5 million ED visits; almost 500,000 hospitalized; adults 65+ visit EDs >600,000 times/yr | CDC Medication Safety Program | current | https://www.cdc.gov/medication-safety/data-research/facts-stats/index.html | "More than 1.5 million people visit emergency departments for ADEs each year in the United States"; "almost 500,000 require hospitalization" | VERIFIED. Note: ADEs include non-error reactions, not only errors |
| Medication-error deaths per year | 7,000 | FDA guidance "Safety Considerations for Product Design to Minimize Medication Errors", citing IOM "To Err Is Human" (2000) | guidance April 2016; data ~1993 | https://www.fda.gov/files/drugs/published/Safety-Considerations-for-Product-Design-to-Minimize-Medication-Errors-Guidance-for-Industry.pdf | "Seven thousand (7,000) deaths annually were attributed to medication errors." | VERIFIED but old data (1998 Lancet study); say "IOM estimated" |
| "1.3 million injured / 1 death per day" | - | patents, WHO secondary | - | n/a | n/a | UNVERIFIED - no FDA page found, excluded |
| Adults 65+ taking 5+ prescription drugs in past 30 days | 43.0% (2017-March 2020), up from 33.3% (2001-2004) | CDC NCHS, Health, United States (NHANES) | 2022 release | https://www.cdc.gov/nchs/hus/topics/rx-drug-use.htm | "for adults age 65 and older, from 33.3% to 43.0%" | VERIFIED |
| Levothyroxine mg/mcg conversion errors | qualitative | ISMP Canada alert 2017-03-08 "Express Levothyroxine Doses in Micrograms not Milligrams" | 2017 | https://www.ismp-canada.org/news/item/275 (redirects) | n/a | UNVERIFIED on page (link now redirects); title seen in search only. Pharmacy Times 2004 column (levothyroxine 0.25 mg ordered instead of 0.025 mg) also snippet only |

---

## F. AI-written code risk

| Claim | Number | Source | Year | URL | Quote | Status |
|---|---|---|---|---|---|---|
| AI-assisted users wrote less secure code and were more confident | qualitative (47 participants in CCS'23 version, per search; not confirmed on page) | Perry, Srivastava, Kumar, Boneh (Stanford), "Do Users Write More Insecure Code with AI Assistants?" | 2022 / CCS 2023 | https://arxiv.org/abs/2211.03622 | participants with an AI assistant "wrote significantly less secure code than those without access"; "were more likely to believe they wrote secure code" | VERIFIED (abstract). Note: Stanford, not NYU |
| LLM code security tests | 45% of test cases introduced vulnerabilities; >100 LLMs; 80 tasks | Veracode 2025 GenAI Code Security Report press release | 2025 (Jul 30) | https://www.veracode.com/press-release/ai-generated-code-poses-major-security-risks-in-nearly-half-of-all-development-tasks-veracode-research-reveals/ | "it introduces security vulnerabilities in 45 percent of cases" | VERIFIED. Caveat: benchmark of curated tasks, not share of real code; vendor study |
| DORA 2024: AI adoption associated with lower delivery stability and throughput | -7.2% stability, -1.5% throughput | Google Cloud DORA announcement | 2024 | https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report | "estimated decrease in delivery throughput by 1.5%, and an estimated reduction in delivery stability by 7.2%" | VERIFIED. Association, not causation. The "per 25% adoption" phrasing applies to the positive effects (e.g. +3.4% code quality); do not attach 25% to these two numbers |
| DORA primary page | - | dora.dev | 2024 | https://dora.dev/research/2024/dora-report/ | "However, it also negatively impacts software delivery stability and throughput." | VERIFIED |
| GitClear: duplicated code blocks up 8x in 2024; copy-pasted lines exceeded moved lines; 211M changed lines 2020-2024 | 8-fold | GitClear "AI Copilot Code Quality 2025", reported by LeadDev | 2025 | https://leaddev.com/software-quality/how-ai-generated-code-accelerates-technical-debt | "copy-pasted lines exceeded moved lines" | SECONDARY (gitclear.com blocked by Cloudflare; primary not read). Exact % values (8.3% to 12.3%) UNVERIFIED |

---

## G. AI productivity: workers vs companies

| Claim | Number | Source | Year | URL | Quote | Status |
|---|---|---|---|---|---|---|
| AI lifts individual output more than company productivity, except a few areas such as software | qualitative | Eric Kutcher, chair of McKinsey North America, at McKinsey media day, as reported by DNYUZ | 2026 (Oct 9) | https://dnyuz.com/?p=295546 | "We have not gotten enterprise-level productivity, with the exception of a few areas." | SECONDARY (news report; McKinsey primary not read) |
| 90% of executives say AI has not boosted productivity yet | 90% of ~750 | Atlanta Fed survey, per a blog summary | 2026 | https://theaicareerlab.com/blog/ai-productivity-paradox-executives-layoffs-2026/raw | n/a | UNVERIFIED (secondary blog; find the Atlanta Fed original before using) |

---

## Top 8 to use in the pitch

1. **Privacy promise, broken (FTC):** "GoodRx promised never to share health data, then did; the FTC's first Health Breach Notification Rule case cost it $1.5M." (FTC, 2023)
2. **Privacy refunds:** "BetterHelp paid $7.8M to consumers over health-data sharing that contradicted its promises." (FTC, 2023)
3. **Accessibility suits are rising:** "3,117 federal website accessibility lawsuits were filed in 2025, up 27% in a year, 36% of all ADA Title III suits." (Seyfarth Shaw, 2026)
4. **Older users, vision loss:** "About 13.6 million US adults 65+ (22.8%) have trouble seeing even with glasses." (AFB analysis of CDC NHIS, 2024)
5. **Mg vs mcg is a known killer pattern:** "ISMP flags the microgram symbol as 'mistaken as mg', a 1,000x unit gap, and tells prescribers to write 'mcg'." (ISMP list; 1,000x is arithmetic)
6. **Polypharmacy:** "43% of US adults 65+ take five or more prescription drugs, so every dosing display bug hits a crowded med list." (CDC NCHS, 2017-2020)
7. **Bugs found late cost far more:** "NASA found fixing a requirements error in operations cost 29x to over 1,500x as much as fixing it early." (Stecklein et al., 2004; hardware/software systems, so say "in NASA's study")
8. **Reports are not reproducible:** "17% of bug reports in six real repositories were non-reproducible, and they stay open three months longer." (Joorabchi et al., MSR 2014). AI-code angle if room: "DORA 2024 links higher AI adoption to a 7.2% drop in delivery stability."

Honorable mentions (use with caveat): Luciq 2026, 15.4% uninstall after a single crash (vendor survey). Veracode 2025, 45% of test cases insecure. Do not use: CCPA $100-$750 for the ignored-opt-out bug (it covers data breaches only); any "x% never report bugs" stat (none verified).
