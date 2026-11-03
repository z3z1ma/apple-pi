## file

Audits Pi session JSONL under `~/.pi/agent/sessions`. Run `node scripts/cache-audit.mjs [substring] [--turns]`.
Why: after turn 2 a healthy prefix cache has cacheRead near the previous turn's total and cacheWrite near only the new content. A larger cacheWrite means the request prefix was rebuilt.
