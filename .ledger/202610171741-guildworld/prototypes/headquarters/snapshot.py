"""PROTOTYPE (throwaway): write live.json from the session-state database for the headquarters prototype.

Run from this directory: python3 snapshot.py   (reads ~/.pi/agent/state/apple-pi.db, or $PI_CODING_AGENT_DIR)
"""

import json
import os
import sqlite3
from pathlib import Path

agent_dir = Path(os.environ.get("PI_CODING_AGENT_DIR") or Path.home() / ".pi" / "agent").expanduser()
db = sqlite3.connect(agent_dir / "state" / "apple-pi.db")
db.execute("pragma query_only = 1")
db.row_factory = sqlite3.Row

rows = db.execute(
    """select s.id, s.name, s.cwd, s.run_state, s.prompt, s.reports_to, s.git, s.current_task, s.current_tool,
        s.current_tool_arg, s.needs_you_since, s.config, i.ended_at, i.process_state
    from sessions s join incarnations i on i.session_id = s.id and i.generation = s.generation
    where s.kind = 'root'"""
).fetchall()

reported_to = {row["reports_to"] for row in rows if row["reports_to"]}
sessions = []
for row in rows:
    git = json.loads(row["git"]) if row["git"] else None
    task = json.loads(row["current_task"]) if row["current_task"] else None
    flags = (json.loads(row["config"]) or {}).get("flags", []) if row["config"] else []
    awake = row["ended_at"] is None and row["process_state"] in ("alive", "alive_bridge_lost")
    sessions.append(
        {
            "id": row["id"],
            "name": row["name"] or Path(row["cwd"]).name,
            "repository": Path(git["repository"]).name if git else None,
            "reportsTo": row["reports_to"],
            "coordinator": "coordinator" in flags or row["id"] in reported_to,
            "awake": awake,
            "status": "waiting" if row["prompt"] else ("idle" if row["run_state"] == "idle" else "busy"),
            "needsYou": row["needs_you_since"] is not None,
            "tool": row["current_tool"],
            "toolArg": row["current_tool_arg"],
            "task": task["taskId"] if task else None,
        }
    )

Path(__file__).with_name("live.json").write_text(json.dumps({"sessions": sessions}, indent=2))
print(f"wrote live.json: {len(sessions)} sessions, {sum(s['awake'] for s in sessions)} awake")
