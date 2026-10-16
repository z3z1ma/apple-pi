"""PROTOTYPE data layer: live root Pi agents joined from state records, tmux, Pi session logs, and the ledger.

Read-only except for pruning dead state records, as `agents.sh` does today.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

PI_DIR = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi" / "agent"))
STATE_DIR = Path(os.environ.get("PI_TMUX_STATE_DIR", PI_DIR / "state" / "tmux-sessions"))
SESSIONS_DIR = PI_DIR / "sessions"
HOME = str(Path.home())
SPARK_MINUTES = 30
SEEN_FILE = Path(tempfile.gettempdir()) / "pi-sidebar-PROTOTYPE-seen.json"


def tmux(*args: str) -> str:
    result = subprocess.run(["tmux", *args], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else ""


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def iso_seconds(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


@dataclass
class LedgerTask:
    task_id: str
    title: str
    status: str


@dataclass
class Activity:
    """What a session log says the agent is doing, folded incrementally from its JSONL."""

    model: str = ""
    context_tokens: int = 0
    cost: float = 0.0
    last_tool: str = ""
    last_tool_detail: str = ""
    tool_times: deque[float] = field(default_factory=deque)


@dataclass
class Agent:
    session_id: str
    pid: int
    status: str
    cwd: str
    session_name: str
    pane_id: str
    started_at: int
    updated_at: int
    tmux_session: str = ""
    window_index: str = ""
    pane_index: str = ""
    focused: bool = False
    unseen: bool = False
    ledger: LedgerTask | None = None
    activity: Activity = field(default_factory=Activity)

    @property
    def location(self) -> str:
        return f"{self.tmux_session}:{self.window_index}.{self.pane_index}"

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


def _first_line(text: str) -> str:
    for line in text.splitlines():
        line = line.strip()
        if line:
            return line
    return ""


_TOOL_DETAIL_KEYS = ("command", "path", "pattern", "query", "description", "task", "name", "code")


def _tool_detail(arguments: object) -> str:
    if not isinstance(arguments, dict):
        return ""
    for key in _TOOL_DETAIL_KEYS:
        value = arguments.get(key)
        if isinstance(value, str) and value.strip():
            detail = _first_line(value).replace(HOME, "~")
            return re.sub(r"^cd \S+ && ", "", detail) if key == "command" else detail
    return ""


class SessionLog:
    """Incremental reader of one Pi session JSONL: parses only bytes appended since the last read."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.offset = 0
        self.activity = Activity()

    def poll(self) -> Activity:
        try:
            size = self.path.stat().st_size
        except FileNotFoundError:
            return self.activity
        if size < self.offset:
            self.offset, self.activity = 0, Activity()
        if size == self.offset:
            return self.activity
        with self.path.open("rb") as handle:
            handle.seek(self.offset)
            chunk = handle.read(size - self.offset)
        end = chunk.rfind(b"\n") + 1
        self.offset += end
        for raw in chunk[:end].splitlines():
            try:
                self._fold(json.loads(raw))
            except (ValueError, KeyError, TypeError, AttributeError):
                continue
        return self.activity

    def _fold(self, entry: dict) -> None:
        act = self.activity
        kind = entry.get("type")
        if kind == "usage":
            act.cost += entry["usage"].get("cost", {}).get("total", 0.0)
            return
        if kind != "message":
            return
        message = entry["message"]
        role = message.get("role")
        if role == "assistant":
            usage = message.get("usage") or {}
            act.cost += (usage.get("cost") or {}).get("total", 0.0)
            if usage.get("totalTokens"):
                act.context_tokens = usage["totalTokens"]
            act.model = message.get("model") or act.model
            at = iso_seconds(entry["timestamp"])
            for part in message.get("content") or []:
                if part.get("type") == "toolCall":
                    act.last_tool = part.get("name", "")
                    act.last_tool_detail = _tool_detail(part.get("arguments"))
                    act.tool_times.append(at)
            cutoff = time.time() - SPARK_MINUTES * 60
            while act.tool_times and act.tool_times[0] < cutoff:
                act.tool_times.popleft()


def _ledger_root(cwd: str) -> Path | None:
    for directory in (Path(cwd), *Path(cwd).parents):
        if (directory / ".ledger").is_dir():
            return directory / ".ledger"
    return None


def _ledger_task(cwd: str, session_id: str) -> LedgerTask | None:
    root = _ledger_root(cwd)
    if root is None:
        return None
    best: tuple[str, Path] | None = None
    for history in root.glob("*/history.json"):
        try:
            sessions = json.loads(history.read_text())["sessions"]
        except (OSError, ValueError, KeyError):
            continue
        for link in sessions:
            if link.get("id") == session_id and (best is None or link.get("linkedAt", "") > best[0]):
                best = (link.get("linkedAt", ""), history.parent)
    if best is None:
        return None
    bundle = best[1]
    title, status = bundle.name, ""
    try:
        for line in (bundle / "task.md").read_text().splitlines():
            if line.startswith("Status:"):
                status = line.removeprefix("Status:").strip()
            elif line.startswith("# "):
                title = line[2:].strip()
                break
    except OSError:
        pass
    return LedgerTask(bundle.name, title, status)


class AgentStore:
    """Polls every source and keeps per-session incremental state between polls."""

    def __init__(self) -> None:
        self.logs: dict[str, SessionLog] = {}
        try:
            self.seen_at: dict[str, float] = json.loads(SEEN_FILE.read_text())
        except (OSError, ValueError):
            self.seen_at = {}
        self.written: dict[str, float] = {}

    def mark_seen(self, session_id: str) -> None:
        self.seen_at[session_id] = time.time()

    def _log(self, session_id: str) -> SessionLog | None:
        log = self.logs.get(session_id)
        if log is None:
            matches = sorted(SESSIONS_DIR.glob(f"*/*_{session_id}.jsonl"))
            if not matches:
                return None
            log = self.logs[session_id] = SessionLog(matches[-1])
        return log

    def poll(self) -> list[Agent]:
        panes: dict[str, list[str]] = {}
        for line in tmux(
            "list-panes",
            "-a",
            "-F",
            "#{pane_id}\t#{session_name}\t#{window_index}\t#{pane_index}",
        ).splitlines():
            pane_id, *fields = line.split("\t")
            panes[pane_id] = fields
        focused = {
            line.split("\t")[0]
            for line in tmux("list-clients", "-F", "#{pane_id}\t#{client_name}").splitlines()
            if line
        }
        now = time.time()
        agents: list[Agent] = []
        for path in STATE_DIR.glob("*.json"):
            try:
                record = json.loads(path.read_text())
            except (OSError, ValueError):
                continue
            pane = panes.get(record.get("paneId", ""))
            if not pid_alive(record.get("pid", 0)):
                path.unlink(missing_ok=True)
                continue
            if pane is None:
                continue
            agent = Agent(
                session_id=record["sessionId"],
                pid=record["pid"],
                status=record.get("status", "idle"),
                cwd=record.get("cwd", ""),
                session_name=record.get("sessionName", ""),
                pane_id=record["paneId"],
                started_at=record.get("startedAt", 0),
                updated_at=record.get("updatedAt", 0),
            )
            agent.tmux_session, agent.window_index, agent.pane_index = pane
            agent.focused = agent.pane_id in focused
            if agent.focused or (agent.session_id not in self.seen_at and agent.status == "busy"):
                self.seen_at[agent.session_id] = now
            agent.unseen = agent.status == "idle" and agent.updated_at > self.seen_at.get(agent.session_id, 0)
            log = self._log(agent.session_id)
            if log is not None:
                agent.activity = log.poll()
            agent.ledger = _ledger_task(agent.cwd, agent.session_id)
            agents.append(agent)
        live = {agent.session_id for agent in agents}
        seen = {sid: at for sid, at in self.seen_at.items() if sid in live}
        self.seen_at = seen
        if seen != self.written:
            SEEN_FILE.write_text(json.dumps(seen))
            self.written = dict(seen)
        rank = {"waiting": 0, "busy": 2, "idle": 3}
        agents.sort(key=lambda a: (0 if a.needs_you else rank.get(a.status, 1), -a.updated_at))
        return agents


if __name__ == "__main__":
    store = AgentStore()
    for agent in store.poll():
        act = agent.activity
        print(
            f"{agent.status:8} {agent.location:18} {agent.name[:40]:40} "
            f"{(agent.ledger.title[:30] if agent.ledger else '-'):30} {act.last_tool}:{act.last_tool_detail[:30]} "
            f"ctx={act.context_tokens} ${act.cost:.2f} {act.model} unseen={agent.unseen} focused={agent.focused}"
        )
