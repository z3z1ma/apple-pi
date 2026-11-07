## file

A name is drawn from one naming culture (operator, 2026-11-07): the culture uniformly, then a first name across its she/he/they lists (so pronouns follow the name), then a family name or, for patronymic cultures, a father's name plus the pronoun's suffix, then a place. The culture data lives in `cultures/*.ts`, one file per region, each a hand-curated list of real names people born 1970 to 2002 commonly have; it was written by peers from cultural knowledge, not from birth registers.
Why: freely mixed first and family names read as invented ("Dafydd Nakashima"); a name from one culture reads as a real colleague.

Draws first respect both the taken full names and the organization's taken first names, then only the full names, and after that keep the last draw. A shared name is better than no name, and with close to a million full names the fallback is not expected in practice.
Coupled: components/session-title/src/culture.ts, components/session-state/src/peers.ts
Verify: components/session-title/tests/session-title.test.ts
