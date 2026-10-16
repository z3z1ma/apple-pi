"""PROTOTYPE: print one JSON line per second with the live pi agents, from the tmux sidebar's AgentStore."""

import json
import sys
import time
from pathlib import Path

repo = next(p for p in Path(__file__).resolve().parents if (p / "components" / "tmux-sessions").is_dir())
sys.path.insert(0, str(repo / "components" / "tmux-sessions" / "sidebar"))

from agents import AgentStore  # noqa: E402


def state(agent) -> str:
    if agent.status == "waiting":
        return "waiting"
    if agent.unseen:
        return "done"
    return "working" if agent.status == "busy" else "quiet"


store = AgentStore()
while True:
    agents = [
        {
            "id": agent.session_id,
            "name": agent.name,
            "project": agent.project,
            "state": state(agent),
            "tool": agent.activity.last_tool,
            "detail": agent.activity.last_tool_detail,
            "model": agent.activity.model,
            "ledger": agent.ledger.title if agent.ledger else "",
            "focused": agent.focused,
            "paneId": agent.pane_id,
            "tmuxSession": agent.tmux_session,
            "updatedAt": agent.updated_at,
        }
        for agent in store.poll()
    ]
    print(json.dumps(agents), flush=True)
    time.sleep(1)
