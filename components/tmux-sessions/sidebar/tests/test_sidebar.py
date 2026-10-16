"""Behaviour of the agent sidebar against fake tmux output and temporary state, session, and ledger files."""

import asyncio
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import agents  # noqa: E402
import sidebar  # noqa: E402


class FakeTmux:
    """Answers the tmux queries the sidebar makes and records the commands it sends."""

    def __init__(self) -> None:
        self.panes: dict[str, dict[str, str]] = {}
        self.focused: set[str] = set()
        self.commands: list[tuple[str, ...]] = []

    def add_pane(self, pane_id: str, seen_at: str = "") -> None:
        self.panes[pane_id] = {"session": "work", "window": "1", "index": str(len(self.panes) + 1), "seen": seen_at}

    def __call__(self, *args: str) -> str:
        if args[0] == "list-panes":
            return "".join(
                f"{pane}\t{p['session']}\t{p['window']}\t{p['index']}\t{p['seen']}\n" for pane, p in self.panes.items()
            )
        if args[0] == "list-clients":
            return "".join(f"{pane}\n" for pane in self.focused)
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
    }
    path = state / f"{session_id}.json"
    path.write_text(json.dumps(data))
    return path


def dead_pid() -> int:
    process = subprocess.Popen(["true"])
    process.wait()
    return process.pid


def test_lists_live_agents_prunes_dead_records_and_keeps_records_without_a_pane(env):
    fake, state, _, _ = env
    fake.add_pane("%1", seen_at="0")
    live = record(state, "live", "%1", "busy", 100)
    dead = record(state, "dead", "%1", "idle", 100, pid=dead_pid())
    elsewhere = record(state, "elsewhere", "%9", "idle", 100)

    found = agents.AgentStore().poll()

    assert [agent.session_id for agent in found] == ["live"]
    assert live.exists() and elsewhere.exists() and not dead.exists()


def test_an_agent_that_settled_after_you_last_looked_needs_you_until_seen(env):
    fake, state, _, _ = env
    now = int(time.time())
    fake.add_pane("%1", seen_at=str(now - 60))
    fake.add_pane("%2", seen_at=str(now))
    record(state, "settled-unseen", "%1", "idle", now - 10)
    record(state, "settled-seen", "%2", "idle", now - 10)
    store = agents.AgentStore()

    by_id = {agent.session_id: agent for agent in store.poll()}
    assert by_id["settled-unseen"].needs_you and not by_id["settled-seen"].needs_you

    fake.focused = {"%1"}
    by_id = {agent.session_id: agent for agent in store.poll()}
    assert not by_id["settled-unseen"].needs_you
    assert ("set", "-p", "-t", "%1", agents.SEEN_OPTION) == fake.commands[-1][:5]
    fake.focused = set()
    assert not {agent.session_id: agent for agent in store.poll()}["settled-unseen"].needs_you


def test_waiting_agents_need_you_and_sort_first(env):
    fake, state, _, _ = env
    for pane in ("%1", "%2", "%3"):
        fake.add_pane(pane, seen_at=str(int(time.time())))
    record(state, "quiet", "%1", "idle", 10)
    record(state, "working", "%2", "busy", 20)
    record(state, "asking", "%3", "waiting", 5)

    assert [agent.session_id for agent in agents.AgentStore().poll()] == ["asking", "working", "quiet"]


def test_session_log_supplies_last_tool_context_and_cost_including_separate_usage_requests(env):
    fake, state, sessions, _ = env
    fake.add_pane("%1", seen_at="0")
    record(state, "s1", "%1", "busy", 1)
    log = sessions / "--project--" / "2026-01-01T00-00-00-000Z_s1.jsonl"
    log.parent.mkdir()
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    assistant = {
        "type": "message",
        "timestamp": stamp,
        "message": {
            "role": "assistant",
            "model": "model-a",
            "usage": {"totalTokens": 120_000, "cost": {"total": 0.5}},
            "content": [{"type": "toolCall", "name": "bash", "arguments": {"command": "cd /repo && npm test"}}],
        },
    }
    side_request = {"type": "usage", "timestamp": stamp, "usage": {"cost": {"total": 0.25}}}
    log.write_text(json.dumps(assistant) + "\n" + json.dumps(side_request) + "\n")
    store = agents.AgentStore()

    act = store.poll()[0].activity
    assert (act.last_tool, act.last_tool_detail, act.context_tokens, act.cost) == ("bash", "npm test", 120_000, 0.75)

    read = {
        **assistant,
        "message": {
            **assistant["message"],
            "content": [{"type": "toolCall", "name": "read", "arguments": {"path": "a.md"}}],
        },
    }
    with log.open("a") as handle:
        handle.write(json.dumps(read) + "\n")
    act = store.poll()[0].activity
    assert (act.last_tool, act.last_tool_detail, act.cost) == ("read", "a.md", 1.25)
    assert sum(store.poll()[0].spark(time.time())) == 2


def test_ledger_task_names_an_unnamed_agent_and_a_session_name_wins(env):
    fake, state, _, tmp_path = env
    repo = tmp_path / "repo"
    bundle = repo / ".ledger" / "202601010000-thing"
    bundle.mkdir(parents=True)
    (bundle / "task.md").write_text("Status: in-progress\nCreated: x\n\n# Build the thing\n")
    (bundle / "history.json").write_text(json.dumps({"sessions": [{"id": "s1", "linkedAt": "2026-01-01"}]}))
    fake.add_pane("%1", seen_at="0")
    path = record(state, "s1", "%1", "busy", 1, cwd=str(repo / "src"))

    agent = agents.AgentStore().poll()[0]
    assert (agent.name, agent.ledger.title, agent.ledger.status) == (
        "Build the thing",
        "Build the thing",
        "in-progress",
    )

    path.write_text(path.read_text().replace('"sessionName": ""', '"sessionName": "Thing builder"'))
    assert agents.AgentStore().poll()[0].name == "Thing builder"


def test_sidebar_groups_agents_into_lanes_and_x_marks_the_selected_agent_seen(env):
    fake, state, _, _ = env
    now = int(time.time())
    fake.add_pane("%1", seen_at="0")
    fake.add_pane("%2", seen_at=str(now))
    fake.add_pane("%3", seen_at=str(now))
    record(state, "done", "%1", "idle", now - 5, name="Finished work")
    record(state, "busy", "%2", "busy", now - 5, name="Busy work")
    record(state, "idle", "%3", "idle", now - 3600, name="Old work")

    async def run() -> tuple[dict[str, str], str, tuple[str, ...]]:
        app = sidebar.Sidebar()
        async with app.run_test(size=(42, 50)) as pilot:
            await pilot.pause(0.5)
            lanes = {
                key: [card.agent.session_id for card in app.query_one(f"#lane-{key}").query(sidebar.Card)]
                for key, _, _ in sidebar.LANES
            }
            count = str(app.query_one("#hero-count").value)
            await pilot.press("x")
            await pilot.pause(0.2)
            return lanes, count, fake.commands[-1]

    lanes, count, last = asyncio.run(run())
    assert lanes == {"need": ["done"], "work": ["busy"], "quiet": ["idle"]}
    assert count == "1"
    assert last[:5] == ("set", "-p", "-t", "%1", agents.SEEN_OPTION)
