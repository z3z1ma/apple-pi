## file

A delegation is an ordinary instruction: `talk` when the agent is idle, `follow_up` when busy, so its turn is not interrupted. It names the item and never writes outside; the agent works through Pi. Reading a Slack thread for the operator is not posting in Slack, so that instruction says to report back here.
Why: the function places ask an agent to work. They must not post or edit the outside item themselves.
Coupled: apps/agent-workplace/src/backend/instructions.ts, apps/agent-workplace/src/integrations.ts
Verify: apps/agent-workplace/tests/integrations/delegation.test.ts
