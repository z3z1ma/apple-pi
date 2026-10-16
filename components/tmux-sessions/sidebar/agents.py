"""Live root Pi agents, joined from the extension's state records, tmux, Pi session logs, and the ledger."""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

PI_DIR = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi" / "agent"))
STATE_DIR = Path(os.environ.get("PI_TMUX_STATE_DIR") or PI_DIR / "state" / "tmux-sessions")
SESSIONS_DIR = PI_DIR / "sessions"
HOME = str(Path.home())
SPARK_MINUTES = 30
SEEN_OPTION = "@pi_seen_at"


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


@dataclass
class LedgerTask:
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
    status: str
    cwd: str
    session_name: str
    pane_id: str
    updated_at: int
    tmux_session: str = ""
    window_index: str = ""
    pane_index: str = ""
    focused: bool = False
    unseen: bool = False
    ledger: LedgerTask | None = None
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
    """Incremental reader of one Pi session JSONL: parses only the bytes appended since the last read."""

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
        # Top-level usage entries are separate requests (forks, cache warming), not copies of message usage.
        if kind == "usage":
            act.cost += entry["usage"].get("cost", {}).get("total", 0.0)
            return
        if kind != "message" or entry["message"].get("role") != "assistant":
            return
        message = entry["message"]
        usage = message.get("usage") or {}
        act.cost += (usage.get("cost") or {}).get("total", 0.0)
        if usage.get("totalTokens"):
            act.context_tokens = usage["totalTokens"]
        act.model = message.get("model") or act.model
        at = datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00")).timestamp()
        for part in message.get("content") or []:
            if part.get("type") == "toolCall":
                act.last_tool = part.get("name", "")
                act.last_tool_detail = _tool_detail(part.get("arguments"))
                act.tool_times.append(at)
        cutoff = time.time() - SPARK_MINUTES * 60
        while act.tool_times and act.tool_times[0] < cutoff:
            act.tool_times.popleft()


def _ledger_task(cwd: str, session_id: str) -> LedgerTask | None:
    """The live ledger task this session linked most recently, from `.ledger/*/history.json`."""
    root = next((d / ".ledger" for d in (Path(cwd), *Path(cwd).parents) if (d / ".ledger").is_dir()), None)
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
    title, status = best[1].name, ""
    try:
        for line in (best[1] / "task.md").read_text().splitlines():
            if line.startswith("Status:"):
                status = line.removeprefix("Status:").strip()
            elif line.startswith("# "):
                title = line[2:].strip()
                break
    except OSError:
        pass
    return LedgerTask(title, status)


def mark_seen(pane_id: str) -> None:
    tmux("set", "-p", "-t", pane_id, SEEN_OPTION, str(int(time.time())))


class AgentStore:
    """Polls every source; keeps each session log's read position between polls."""

    def __init__(self) -> None:
        self.logs: dict[str, SessionLog] = {}

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
            f"#{{pane_id}}\t#{{session_name}}\t#{{window_index}}\t#{{pane_index}}\t#{{{SEEN_OPTION}}}",
        ).splitlines():
            pane_id, *fields = line.split("\t")
            panes[pane_id] = fields
        focused = {line for line in tmux("list-clients", "-F", "#{pane_id}").splitlines() if line}
        agents: list[Agent] = []
        for path in STATE_DIR.glob("*.json"):
            try:
                record = json.loads(path.read_text())
            except (OSError, ValueError):
                continue
            if not pid_alive(record.get("pid", 0)):
                path.unlink(missing_ok=True)
                continue
            pane = panes.get(record.get("paneId", ""))
            if pane is None:
                continue
            agent = Agent(
                session_id=record["sessionId"],
                status=record.get("status", "idle"),
                cwd=record.get("cwd", ""),
                session_name=record.get("sessionName", ""),
                pane_id=record["paneId"],
                updated_at=record.get("updatedAt", 0),
            )
            agent.tmux_session, agent.window_index, agent.pane_index, seen_at = pane
            agent.focused = agent.pane_id in focused
            settled_unseen = agent.status == "idle" and agent.updated_at > int(seen_at or 0)
            # An agent that settles while you watch its pane gets no focus-in event, so watching counts as seeing.
            if settled_unseen and agent.focused:
                mark_seen(agent.pane_id)
            agent.unseen = settled_unseen and not agent.focused
            log = self._log(agent.session_id)
            if log is not None:
                agent.activity = log.poll()
            agent.ledger = _ledger_task(agent.cwd, agent.session_id)
            agents.append(agent)
        rank = {"waiting": 0, "busy": 2, "idle": 3}
        agents.sort(key=lambda a: (0 if a.needs_you else rank.get(a.status, 1), -a.updated_at))
        return agents
