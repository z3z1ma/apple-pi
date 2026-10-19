"""Live root Pi sessions of this tmux server, read from the session-state database, and commands to its runtime."""

from __future__ import annotations

import json
import os
import socket
import sqlite3
import subprocess
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path


def agent_dir() -> Path:
    """Pi's rule for `PI_CODING_AGENT_DIR`: unset or empty means `~/.pi/agent`, and a leading `~` means home."""
    configured = os.environ.get("PI_CODING_AGENT_DIR") or ""
    if not configured:
        return Path.home() / ".pi" / "agent"
    if configured == "~" or configured.startswith("~/"):
        return Path.home() / configured[2:]
    return Path(configured).resolve()


STATE_DIR = agent_dir() / "state"
DB_PATH = STATE_DIR / "apple-pi.db"
SOCKET_PATH = STATE_DIR / "apple-pi.sock"
SPARK_MINUTES = 30


def tmux(*args: str) -> str:
    result = subprocess.run(["tmux", *args], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else ""


@dataclass
class LedgerTask:
    title: str
    status: str


@dataclass
class Activity:
    model: str = ""
    context_tokens: int = 0
    cost: float = 0.0
    last_tool: str = ""
    last_tool_detail: str = ""
    tool_times: deque[float] = field(default_factory=deque)


@dataclass
class Agent:
    session_id: str
    generation: int
    status: str
    cwd: str
    session_name: str
    pane_id: str
    updated_at: int
    needs_you_since: int | None = None
    tmux_session: str = ""
    window_index: str = ""
    pane_index: str = ""
    focused: bool = False
    unseen: bool = False
    ledger: LedgerTask | None = None
    # What the session says it works on now (its stated intent), shown when it has no ledger task.
    intent: str = ""
    activity: Activity = field(default_factory=Activity)

    @property
    def project(self) -> str:
        return Path(self.cwd).name or self.cwd

    @property
    def needs_you(self) -> bool:
        return self.status == "waiting" or self.unseen

    @property
    def name(self) -> str:
        if self.session_name:
            return self.session_name
        if self.ledger:
            return self.ledger.title
        return self.project

    def spark(self, now: float) -> list[float]:
        buckets = [0.0] * SPARK_MINUTES
        for at in self.activity.tool_times:
            age = int((now - at) // 60)
            if 0 <= age < SPARK_MINUTES:
                buckets[SPARK_MINUTES - 1 - age] += 1
        return buckets


def connect() -> sqlite3.Connection | None:
    if not DB_PATH.exists():
        return None
    # Opened for writing but query-only: a strictly read-only connection reads no rows from a WAL database whose
    # -shm file is gone, as after the runtime stops.
    db = sqlite3.connect(DB_PATH)
    db.execute("pragma query_only = 1")
    db.row_factory = sqlite3.Row
    return db


LIVE_SESSIONS = """
select s.id, s.generation, s.run_state, s.prompt, s.cwd, s.name, s.updated_at, s.needs_you_since, s.model,
    s.context_tokens, s.cost, s.current_tool, s.current_tool_arg, s.current_task, {intent}, i.pane_id,
    (select ts.name from tmux_window_links l join tmux_sessions ts on ts.socket = l.socket and ts.id = l.session_id
        where l.socket = p.socket and l.window_id = p.window_id order by l.window_index limit 1) as tmux_session,
    (select l.window_index from tmux_window_links l
        where l.socket = p.socket and l.window_id = p.window_id order by l.window_index limit 1) as window_index
from sessions s
join incarnations i on i.session_id = s.id and i.generation = s.generation
left join tmux_panes p on p.socket = i.tmux_socket and p.id = i.pane_id
where s.kind = 'root' and i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost')
    and i.tmux_socket = ? and i.pane_id is not null
"""


def ledger_task(current_task: str | None) -> LedgerTask | None:
    if not current_task:
        return None
    try:
        task = json.loads(current_task)
        bundle, task_id = str(task["bundle"]), str(task["taskId"])
    except (ValueError, KeyError, TypeError):
        return None
    title, status = "", ""
    try:
        for line in (Path(bundle) / "task.md").read_text().splitlines():
            if not status and line.startswith("Status:"):
                status = line.removeprefix("Status:").strip()
            elif not title and line.startswith("# "):
                title = line[2:].strip()
    except OSError:
        pass
    return LedgerTask(title or task_id, status)


def live() -> list[Agent]:
    """This tmux server's live top-level sessions in attention order: needs-you first, the longest-waiting first;
    then working, then idle, most recently changed first."""
    server, focused, pane_index = "", set(), {}
    for line in tmux(
        "display-message",
        "-p",
        "server\t#{socket_path}",
        ";",
        "list-clients",
        "-F",
        "client\t#{pane_id}",
        ";",
        "list-panes",
        "-a",
        "-F",
        "pane\t#{pane_id}\t#{pane_index}",
    ).splitlines():
        kind, *fields = line.split("\t")
        if kind == "server" and fields:
            server = fields[0]
        elif kind == "client" and fields:
            focused.add(fields[0])
        elif kind == "pane" and len(fields) == 2:
            pane_index[fields[0]] = fields[1]
    db = connect() if server else None
    if db is None:
        return []
    try:
        # A runtime started before the migration that adds `intent` runs old code, and its database lacks the column.
        has_intent = db.execute("select 1 from pragma_table_info('sessions') where name = 'intent'").fetchone()
        sql = LIVE_SESSIONS.format(intent="s.intent" if has_intent else "null as intent")
        # The runtime keys tmux servers by resolved socket path.
        rows = db.execute(sql, (os.path.realpath(server),)).fetchall()
    finally:
        db.close()
    agents = []
    for row in rows:
        waiting = row["prompt"] is not None
        agent = Agent(
            session_id=row["id"],
            generation=row["generation"],
            status="waiting" if waiting else "busy" if row["run_state"] != "idle" else "idle",
            cwd=row["cwd"],
            session_name=row["name"] or "",
            pane_id=row["pane_id"],
            updated_at=row["updated_at"] // 1000,
            needs_you_since=row["needs_you_since"],
            tmux_session=row["tmux_session"] or "",
            window_index="" if row["window_index"] is None else str(row["window_index"]),
            pane_index=pane_index.get(row["pane_id"], ""),
            focused=row["pane_id"] in focused,
            unseen=row["needs_you_since"] is not None and not waiting,
            ledger=ledger_task(row["current_task"]),
            intent=(row["intent"] or "").strip(),
            activity=Activity(
                model=row["model"] or "",
                context_tokens=row["context_tokens"] or 0,
                cost=row["cost"] or 0.0,
                last_tool=row["current_tool"] or "",
                last_tool_detail=row["current_tool_arg"] or "",
            ),
        )
        agents.append(agent)
    agents.sort(key=attention_order)
    return agents


def attention_order(agent: Agent) -> tuple[int, int]:
    if agent.needs_you:
        return (0, agent.needs_you_since or 0)
    return (1 if agent.status == "busy" else 2, -agent.updated_at)


class Store:
    """Live sessions with their tool history, folded from new `tool_started` events on each poll."""

    def __init__(self) -> None:
        self.seq = 0
        self.last_tool: dict[str, tuple[str, str]] = {}
        self.tool_times: dict[str, deque[float]] = {}

    def poll(self) -> list[Agent]:
        agents = live()
        db = connect()
        if db is not None:
            try:
                rows = db.execute(
                    "select seq, session_id, at, data from events where seq > ? and type = 'tool_started' order by seq",
                    (self.seq,),
                ).fetchall()
            finally:
                db.close()
            for row in rows:
                self.seq = row["seq"]
                try:
                    data = json.loads(row["data"])
                except (TypeError, ValueError):
                    continue
                self.last_tool[row["session_id"]] = (data.get("name") or "", data.get("arg") or "")
                self.tool_times.setdefault(row["session_id"], deque()).append(row["at"] / 1000)
        # Ended sessions' tools are dropped, so an always-on view does not grow over days.
        live_ids = {agent.session_id for agent in agents}
        self.last_tool = {session_id: tool for session_id, tool in self.last_tool.items() if session_id in live_ids}
        cutoff = time.time() - SPARK_MINUTES * 60
        for session_id, times in list(self.tool_times.items()):
            while times and times[0] < cutoff:
                times.popleft()
            if not times:
                del self.tool_times[session_id]
        for agent in agents:
            act = agent.activity
            if not act.last_tool:
                act.last_tool, act.last_tool_detail = self.last_tool.get(agent.session_id, ("", ""))
            act.tool_times = deque(self.tool_times.get(agent.session_id, ()))
        return agents


RUNTIME_DOWN = "the session-state runtime is not running"


def send(agent: Agent, command: dict, wait: bool = False) -> str | None:
    """Send one command for the agent's current incarnation to the runtime; returns why it failed, or None.

    With `wait`, it returns only once the runtime answers that the command was applied or failed, so call it off
    the UI thread.
    """
    command_id = str(uuid.uuid4())
    line = {
        "type": "command",
        "commandId": command_id,
        "sessionId": agent.session_id,
        "generation": agent.generation,
        "command": command,
    }
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(1)
            connection.connect(str(SOCKET_PATH))
            connection.sendall((json.dumps(line) + "\n").encode())
            if not wait:
                return None
            connection.settimeout(None)
            for raw in connection.makefile():
                receipt = json.loads(raw)
                if receipt.get("commandId") != command_id:
                    continue
                if receipt.get("stage") == "applied":
                    return None
                if receipt.get("stage") == "failed":
                    return receipt.get("reason") or "failed"
    except OSError:
        return RUNTIME_DOWN
    return "the runtime closed the connection before answering"


def mark_seen(agent: Agent) -> str | None:
    return send(agent, {"kind": "mark_seen"})


def talk(agent: Agent, text: str) -> str | None:
    """Wait for the runtime's answer (see `send`)."""
    return send(agent, {"kind": "talk", "text": text}, wait=True)
