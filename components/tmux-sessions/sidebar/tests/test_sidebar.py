"""Behaviour of the agent sidebar against fake tmux output and temporary state, session, and ledger files."""

import asyncio
import json
import time

import agents
import sidebar
from conftest import dead_pid, record


def test_lists_live_agents_and_prunes_dead_or_paneless_records_of_this_tmux_server_only(env):
    fake, state, _, _ = env
    fake.add_pane("%1", seen_at="0")
    live = record(state, "live", "%1", "busy", 100)
    dead = record(state, "dead", "%1", "idle", 100, pid=dead_pid())
    paneless = record(state, "paneless", "%9", "idle", 100)
    legacy = record(state, "legacy", "%8", "idle", 100, socket=None)
    other_server = record(state, "other-server", "%9", "idle", 100, socket="/tmp/tmux-test/other")
    # Another server's agent whose pane id happens to exist here too must not pose as a local agent,
    # whether its record names that server or predates server names (then its pane tty gives it away).
    colliding = record(state, "colliding", "%1", "waiting", 100, socket="/tmp/tmux-test/other")
    colliding_legacy = record(state, "colliding-legacy", "%1", "waiting", 100, socket=None, tty="/dev/ttys999")

    found = agents.AgentStore().poll()

    assert [agent.session_id for agent in found] == ["live"]
    assert all(path.exists() for path in (live, other_server, colliding, colliding_legacy, legacy))
    assert not dead.exists() and not paneless.exists()


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


def test_status_summary_counts_agents_by_state_and_is_empty_without_agents(env):
    fake, state, _, _ = env
    assert agents.summary(agents.live()) == ""
    now = int(time.time())
    for pane in ("%1", "%2", "%3", "%4"):
        fake.add_pane(pane, seen_at=str(now - 100))
    record(state, "asking", "%1", "waiting", now - 50)
    record(state, "done", "%2", "idle", now - 50)
    record(state, "working", "%3", "busy", now - 50)
    record(state, "quiet", "%4", "idle", now - 200)

    line = agents.summary(agents.live())

    for part in ("? 1", "\u2713 1", "\u283f 1", "\u00b7 1"):
        assert part in line


def test_jump_target_is_the_agent_that_has_needed_you_longest_other_than_your_pane(env):
    fake, state, _, _ = env
    now = int(time.time())
    for pane in ("%1", "%2", "%3"):
        fake.add_pane(pane, seen_at=str(now - 1000))
    record(state, "older", "%1", "waiting", now - 300)
    record(state, "newer", "%2", "idle", now - 60)
    record(state, "busy", "%3", "busy", now - 900)

    assert agents.next_agent(agents.live(), "%9").session_id == "older"
    assert agents.next_agent(agents.live(), "%1").session_id == "newer"
    fake.panes["%2"]["seen"] = str(now)
    assert agents.next_agent(agents.live(), "%1") is None
