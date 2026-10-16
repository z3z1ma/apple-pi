"""Shared fakes: tmux answers and temporary state, session, and ledger files for the sidebar and dashboard tests."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import agents  # noqa: E402
import dashboard  # noqa: E402
import sidebar  # noqa: E402


SOCKET = "/tmp/tmux-test/default"


class FakeTmux:
    """Answers the tmux queries the sidebar makes and records the commands it sends."""

    def __init__(self) -> None:
        self.panes: dict[str, dict[str, str]] = {}
        self.focused: set[str] = set()
        self.commands: list[tuple[str, ...]] = []
        self.screens: dict[str, str] = {}
        self.watched = True

    def add_pane(self, pane_id: str, seen_at: str = "") -> None:
        self.panes[pane_id] = {"session": "work", "window": "1", "index": str(len(self.panes) + 1), "seen": seen_at}

    def __call__(self, *args: str) -> str:
        if args[0] == "list-panes":
            return "".join(
                f"{SOCKET}\t{pane}\t{p['session']}\t{p['window']}\t{p['index']}\t{p['seen']}\n"
                for pane, p in self.panes.items()
            )
        if args[:3] == ("list-clients", "-F", "#{window_id}"):
            return "@1\n" if self.watched else ""
        if args[0] == "list-clients":
            return "".join(f"{pane}\n" for pane in self.focused)
        if args[0] == "capture-pane":
            return self.screens.get(args[-1], "")
        if args[:2] == ("display-message", "-p") and args[-1] == "#{window_id}":
            return "@1\n"
        self.commands.append(args)
        if args[:2] == ("set", "-p"):
            self.panes[args[3]]["seen"] = args[5]
        return ""


@pytest.fixture
def env(tmp_path, monkeypatch):
    fake = FakeTmux()
    state = tmp_path / "state"
    sessions = tmp_path / "sessions"
    state.mkdir()
    sessions.mkdir()
    monkeypatch.setattr(agents, "tmux", fake)
    monkeypatch.setattr(sidebar, "tmux", fake)
    monkeypatch.setattr(dashboard, "tmux", fake)
    monkeypatch.setattr(agents, "STATE_DIR", state)
    monkeypatch.setattr(agents, "SESSIONS_DIR", sessions)
    return fake, state, sessions, tmp_path


def record(state: Path, session_id: str, pane: str, status: str, updated_at: int, pid: int | None = None, **extra):
    data = {
        "schema": 1,
        "sessionId": session_id,
        "pid": os.getpid() if pid is None else pid,
        "status": status,
        "cwd": extra.get("cwd", "/tmp/project"),
        "sessionName": extra.get("name", ""),
        "paneId": pane,
        "updatedAt": updated_at,
        "tmuxSocket": extra.get("socket", SOCKET),
    }
    if data["tmuxSocket"] is None:
        del data["tmuxSocket"]
    path = state / f"{session_id}.json"
    path.write_text(json.dumps(data))
    return path


def dead_pid() -> int:
    process = subprocess.Popen(["true"])
    process.wait()
    return process.pid
