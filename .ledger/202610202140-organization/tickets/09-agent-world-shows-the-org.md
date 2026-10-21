# 09: Agent World shows the org

**What to build:** Agent World draws the org tree instead of one coordinator's star. The headquarters belongs to the root the operator is in; each manager's team has a room off it; independents stand in the square; former members sleep at the inn with a leaving mark. Each character's profile card shows its role title, soul line, self headings, manager, and record. The hire form offers the catalog with each role's mandate, and the theme words it (hire, recruit, invite; leave the guild, resign, graduate for retire).

**Blocked by:** 03 The org tree, the directory, and the charters; 05 A hired person has a soul; 06 Every person keeps a self

**Status:** done

- [x] In the headless UI test, a root with a manager and two reports draws the manager's team in its own room and the root at its desk; a second root is a second headquarters.
- [x] A character's profile card shows role title, soul line, self headings, manager, and ledger tasks for a hired person, and no role or soul for the operator's root.
- [x] The hire form lists every catalog role with its mandate, and submitting it starts a person with that role that walks into the hiring manager's room.
- [x] All three themes word hire and retire in their own verbs and draw the leaving mark on former members at the inn.

Deviations: the tree is projected in the backend (`backend.test.ts` over a real runtime: root at its desk, the manager's team room, a second root a second headquarters, a retired person at the inn marked so); the headless UI tests draw a team room as a wing named after its manager, the card rows, the hire form's roles, and the retire form in every theme. The backend reads the catalog from `roles/*.md` front matter itself (`src/backend/roles.ts`), and the new columns through its pragma guard, so it imports nothing from `components/organization`. A new `manages` fact and column tells the backend which sessions manage without the catalog.
