Status: done
Created: 2026-10-19
Updated: 2026-10-19

# Retrospective

## What Mattered

- The operator's walkthrough list was concrete enough to ticket at once; four questions (Slack read, exteriors, recruiting, NPC richness) settled what the list left open, and the tickets were approved in one review.
- Generating all new art first (idle sheets, pets, the ambient cast, recruiters, exteriors, cursors) let five or more lanes run at once on finished art.
- Attaching a look's own sheet as a reference image (`codex exec ... -i <sheet>`, after the prompt) was what kept generated idle sheets the same person.
- Depth and grounding were fixed entirely in place data, with a depth test that walks the avatar around every foreground piece and blocked rect.

## Learnings

- Codex art: a text brief alone redraws a different person; attach the existing sheet with `-i`, and put `-i` after the prompt, since it takes several files.
- The long-lived session-state runtime keeps running old code until restarted; a schema change (the `intent` column) needs a restart before it stores anything, and views must tolerate the column being absent meanwhile.
- A builder that dies on a provider error can be resumed by id with its edits intact.
- The operator wants only affected tests run per lane, and one full suite at the end.

## Improvements

- Lanes still ran the full world suite under heavy load (load averages above 30) before the rule was set; brief every lane with the affected-tests rule from the start.
