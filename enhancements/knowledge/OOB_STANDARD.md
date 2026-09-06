# TOC Monkey AO / OOB Knowledge Standard

Version 1.0 — 2026-09-06

## Purpose

TOC Monkey's AO / Task Org explorer is an open-source research index, not a claim of official intelligence. The goal is to let a user select a country or network and follow a sourced organizational rabbit hole: who operates there, how organizations relate, what systems they use, where they are based, and which reporting supports the entry.

A generated country node or generic `Defense & Security Institutions — Country` node is navigation only. It never counts as substantive OOB coverage.

## Country coverage states

Every country is evaluated against the same machine-readable coverage matrix.

- `INDEX ONLY`: zero to two substantive categories represented.
- `BASIC`: three to five categories represented.
- `DEVELOPED`: six to ten categories represented, or important critical categories remain missing.
- `COMPREHENSIVE`: eleven or more categories represented and no critical category is missing.

The current scored categories are:

1. command authority **critical**
2. defense ministry / joint command **critical**
3. land force **critical**
4. air component
5. interior / police **critical**
6. intelligence / internal security **critical**
7. border security
8. special operations
9. operational formations
10. major systems / equipment
11. non-state armed threats **critical**
12. organized crime / trafficking
13. external sponsors / partners / cross-border relationships
14. bases / garrisons / operating locations

Maritime forces are tracked as substantive actors where applicable but are not a universal scored category because many countries are landlocked.

## Mandatory research questions

For each country, researchers should determine whether the following exist and either build a sourced actor or explicitly document that the category is not applicable / not publicly resolved:

- national command authority
- defense ministry or equivalent
- army / ground force
- air force or aviation component
- navy / coast guard where applicable
- air-defense / missile forces where important
- special operations forces
- national guard / gendarmerie / paramilitary forces
- intelligence and internal-security organizations
- border forces
- major operational commands, corps, divisions, regional commands and important specialized formations
- major bases, headquarters, ports and airfields
- major weapons and systems
- foreign forces regularly stationed or operating in the country
- militias, proxies and private military formations
- insurgent / terrorist / separatist organizations
- organized-crime and trafficking networks
- external sponsors, partners and important cross-border relationships

## Actor dossier minimum

Important actors should contain, where supportable from open sources:

- canonical name and useful aliases / keywords
- actor type and country / network
- plain-language summary
- current status
- confidence statement when the public picture is incomplete
- leadership for important top-level organizations
- parent / subordinate relationships
- mission / capabilities
- operating area, with uncertainty clearly marked
- systems / equipment with serviceability caveats where appropriate
- bases / garrison context when responsibly supportable
- source shelf
- last-reviewed date

Do not invent precision. If current subordinate structure, strength, readiness, basing or boundaries are not consistently public, say so.

## Source hierarchy

### Tier 1 — primary / authoritative

Prefer defense ministries, military services, COCOMs, State Department, Treasury / sanctions authorities, NCTC, CIA World Factbook, UN, NATO, EU and other official government or intergovernmental publications.

### Tier 2 — high-quality specialist research

Use established defense, conflict, organized-crime and academic research institutions when primary material is unavailable or incomplete.

### Tier 3 — reputable current reporting

Use major reputable news organizations for recent changes, appointments and operational developments, especially when primary sources lag.

### Tier 4 — discovery only

Wikipedia and similar aggregators may identify leads, alternate spellings or references but should not normally be the only source for an important OOB claim.

Important or disputed claims should target two independent sources when practical.

## Confidence and temporal rules

Use explicit language such as:

- `CONFIRMED` / `HIGH`
- `MODERATE`
- `LOW`
- `HISTORICAL`
- `DISBANDED / REORGANIZED`
- `STATUS UNCLEAR`

Do not display historical organizations as current merely because they remain easy to find online. Current existence does not imply current readiness, strength or unchanged command relationships.

## Relationship vocabulary

Prefer specific relationships over generic `related to` links:

- `COMMANDS`
- `SUBORDINATE TO`
- `SUPPORTED BY`
- `TRAINED BY`
- `EQUIPPED BY`
- `ALLIED WITH`
- `RIVAL OF`
- `SPLINTER OF`
- `PROXY OF`
- `OPERATES IN`
- `BASED AT`
- `USES SYSTEM`
- `SANCTIONED / DESIGNATED BY`
- `CROSS-BORDER SECURITY CONCERN`

Use neutral descriptive language where a relationship is contested or politically sensitive.

## Automation rule

Automated news / RSS reporting may add `recentSignals` or produce analyst-review proposals. It must not silently rewrite the durable baseline OOB, leadership, strength, systems, alignment or organizational relationships.

The workflow is:

`new reporting -> proposed change -> source/confidence check -> analyst approval -> baseline update`

## Review cadence

- high-priority / rapidly changing countries: every 30–60 days
- important but slower-changing countries: every 90–180 days
- lower-priority stable countries: annually or event-triggered
- major war, coup, reorganization, designation, leadership change or force deployment: immediate review flag

## Gold-standard prototypes

The schema should be proven against different archetypes before mass expansion:

1. Afghanistan — de facto governing movement + security ministries + inherited force + terrorism + cross-border networks
2. Iran — conventional services + IRGC parallel structure + missiles + proxies
3. China — large formal joint force + theater commands + systems
4. Somalia — national force + foreign mission / partners + insurgency
5. Mexico — military + internal security + organized crime / TCO networks

A new bulk expansion should not be considered complete until the coverage auditor identifies its gaps and the highest-priority missing categories are resolved.
