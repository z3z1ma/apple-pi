"""Behaviour of the agent sidebar against a session-state database built by the runtime's migrations."""

import asyncio
import time

import dashboard
import model
import sidebar


def ids(agents):
    return [agent.session_id for agent in agents]


def test_lists_only_live_root_sessions_in_panes_of_this_tmux_server(world, monkeypatch):
    world.add("live", "%1", "thinking")
    world.add("child", "%2", kind="child")
    world.add("ended", "%3", ended=True)
    world.add("lost", "%4", process_state="lost")
    world.add("bridge-lost", "%5", process_state="alive_bridge_lost")
    world.add("other-server", "%6", socket="/private/tmp/tmux-test/other")
    world.add("superseded", "%7", generation=2, incarnation=1)
    world.add("no-pane", None)

    assert sorted(ids(model.live())) == ["bridge-lost", "live"]
    monkeypatch.setattr(model, "DB_PATH", world.tmp_path / "missing.db")
    assert model.live() == []


def test_status_needs_you_and_attention_order_follow_the_recorded_facts(world):
    now = time.time()
    world.add("quiet-old", "%1", updated_at=now - 900)
    world.add("quiet-new", "%2", updated_at=now - 60)
    world.add("working", "%3", "running_tool", updated_at=now - 30)
    world.add("done", "%4", needs_you_since=now - 100, updated_at=now - 100)
    world.add("asking", "%5", "running_tool", prompt={"id": "q1"}, needs_you_since=now - 300)

    agents = model.live()

    assert ids(agents) == ["asking", "done", "working", "quiet-new", "quiet-old"]
    by_id = {agent.session_id: agent for agent in agents}
    assert [(by_id[key].status, by_id[key].unseen) for key in ids(agents)] == [
        ("waiting", False),
        ("idle", True),
        ("busy", False),
        ("idle", False),
        ("idle", False),
    ]
    assert by_id["working"].updated_at == int(now - 30)


def test_last_tool_falls_back_to_the_latest_tool_event_and_the_spark_counts_recent_tools(world):
    now = time.time()
    world.add("running", "%1", "running_tool", current_tool="bash", current_tool_arg="npm test")
    world.add("idle", "%2")
    world.tool_started("idle", "read", "old.md", now - 3 * 3600)
    world.tool_started("idle", "edit", "a.md", now - 120)
    world.tool_started("idle", "bash", "ls", now - 60)
    store = model.Store()

    by_id = {agent.session_id: agent for agent in store.poll()}
    assert (by_id["running"].activity.last_tool, by_id["running"].activity.last_tool_detail) == ("bash", "npm test")
    assert (by_id["idle"].activity.last_tool, by_id["idle"].activity.last_tool_detail) == ("bash", "ls")
    assert sum(by_id["idle"].spark(now)) == 2

    world.tool_started("idle", "grep", "TODO", now)
    idle = next(agent for agent in store.poll() if agent.session_id == "idle")
    assert (idle.activity.last_tool, sum(idle.spark(now))) == ("grep", 3)


def test_the_ledger_task_names_an_unnamed_session_falls_back_to_its_id_and_a_session_name_wins(world):
    bundle = world.task("202601010000-thing", "Status: in-progress\nCreated: x\n\n# Build the thing\n")
    world.add("tasked", "%1", current_task={"bundle": bundle, "taskId": "202601010000-thing"})
    world.add("missing", "%2", current_task={"bundle": "/nowhere/x", "taskId": "202601010000-gone"})
    world.add("named", "%3", name="Thing builder", current_task={"bundle": bundle, "taskId": "202601010000-thing"})

    by_id = {agent.session_id: agent for agent in model.live()}
    assert (by_id["tasked"].name, by_id["tasked"].ledger.status) == ("Build the thing", "in-progress")
    assert by_id["missing"].name == "202601010000-gone"
    assert by_id["named"].name == "Thing builder"


def card_text(app):
    return {
        card.agent.session_id: {
            "lane": card.parent.id,
            "title": str(card.border_title),
            "task": str(card.query_one(".task").shown),
            "act": str(card.query_one(".act").shown),
            "meta": str(card.query_one(".meta").shown),
        }
        for card in app.query(sidebar.Card)
    }


def test_a_session_shows_its_name_status_tool_ledger_task_cost_context_and_lane_as_recorded(world):
    now = time.time()
    bundle = world.task("202601010000-login", "Status: in-progress\n\n# Fix the login bug\n")
    world.add(
        "worker",
        "%1",
        "running_tool",
        name="Login fixer",
        cwd="/repo/app",
        current_tool="bash",
        current_tool_arg="npm test",
        current_task={"bundle": bundle, "taskId": "202601010000-login"},
        model="claude",
        context_tokens=120_000,
        cost=1.25,
    )
    world.add("finished", "%2", name="Finished work", needs_you_since=now - 10)

    async def run():
        app = sidebar.Sidebar()
        async with app.run_test(size=(60, 50)) as pilot:
            await pilot.pause(0.5)
            return card_text(app), str(app.query_one("#hero-count").value)

    cards, count = asyncio.run(run())
    assert cards["worker"]["lane"] == "lane-work"
    assert "Login fixer" in cards["worker"]["title"]
    assert cards["worker"]["task"] == "◆ Fix the login bug in-progress"
    assert cards["worker"]["act"] == "bash npm test"
    assert cards["worker"]["meta"] == "120k $1.25"
    assert cards["finished"]["lane"] == "lane-need" and "✓" in cards["finished"]["title"]
    assert count == "1"


def test_x_sends_mark_seen_for_the_selected_session_and_capital_x_for_every_session(world):
    now = time.time()
    world.add("done", "%1", name="Finished work", needs_you_since=now - 5)
    world.add("busy", "%2", "thinking", name="Busy work")

    async def run():
        app = sidebar.Sidebar()
        async with app.run_test(size=(42, 50)) as pilot:
            await pilot.pause(0.5)
            await pilot.press("x")
            await pilot.pause(0.2)
            first = world.runtime.commands()
            await pilot.press("X")
            await pilot.pause(0.2)
            return first, world.runtime.commands()

    first, every = asyncio.run(run())
    assert first == [("done", {"kind": "mark_seen"})]
    assert sorted(every[1:]) == [("busy", {"kind": "mark_seen"}), ("done", {"kind": "mark_seen"})]
    assert world.runtime.lines[0]["generation"] == 1 and world.runtime.lines[0]["type"] == "command"


def test_the_sidebar_keeps_running_when_the_runtime_is_down(world, monkeypatch):
    world.add("done", "%1", needs_you_since=time.time())
    monkeypatch.setattr(model, "SOCKET_PATH", world.tmp_path / "no-runtime.sock")

    async def run():
        app = sidebar.Sidebar()
        async with app.run_test(size=(42, 50)) as pilot:
            await pilot.pause(0.5)
            await pilot.press("x")
            await pilot.pause(0.2)
            return app.is_running, len(app.agents)

    assert asyncio.run(run()) == (True, 1)


def test_without_a_ledger_task_a_session_shows_its_stated_intent_and_a_task_wins_over_it(world):
    bundle = world.task("202601010000-login", "Status: in-progress\n\n# Fix the login bug\n")
    world.add("stated", "%1", name="Ada Lovejoy", intent="Fixing the CSV parser crash")
    world.add(
        "tasked",
        "%2",
        name="Kofi Marchetti",
        intent="Reading the billing code",
        current_task={"bundle": bundle, "taskId": "202601010000-login"},
    )
    world.add("neither", "%3", name="Orla Brannigan", cwd="/repo/app")

    async def run():
        app = sidebar.Sidebar()
        async with app.run_test(size=(60, 50)) as pilot:
            await pilot.pause(0.5)
            return card_text(app)

    cards = asyncio.run(run())
    assert cards["stated"]["task"] == "◇ Fixing the CSV parser crash"
    assert cards["tasked"]["task"] == "◆ Fix the login bug in-progress"
    assert cards["neither"]["task"] == "◇ no ledger task · app"

    now = time.time()
    by_id = {agent.session_id: agent for agent in model.live()}
    assert str(dashboard.cells(by_id["stated"], now, 0)["task"]) == "Fixing the CSV parser crash"
    assert str(dashboard.cells(by_id["tasked"], now, 0)["task"]) == "Fix the login bug"


def test_a_database_an_older_runtime_has_not_migrated_yet_still_lists_its_sessions(world):
    world.add("old", "%1", name="Older")
    world.execute("alter table sessions drop column intent")
    agents = model.live()
    assert [(agent.session_id, agent.intent) for agent in agents] == [("old", "")]
