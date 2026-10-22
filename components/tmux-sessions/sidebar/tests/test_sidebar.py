"""Behaviour of the agent sidebar against a session-state database built by the runtime's migrations."""

import asyncio
import time

import dashboard
import model
import presentation
import sidebar
from textual.content import Content


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
    # Settled unseen, then mail started another run: it works, waits for nobody, and keeps its unseen result.
    world.add("working-again", "%6", "running_tool", needs_you_since=now - 400, updated_at=now - 20)

    agents = model.live()

    assert ids(agents) == ["asking", "done", "working-again", "working", "quiet-new", "quiet-old"]
    by_id = {agent.session_id: agent for agent in agents}
    assert [(by_id[key].status, by_id[key].unseen, by_id[key].needs_you) for key in ids(agents)] == [
        ("waiting", False, True),
        ("idle", True, True),
        ("busy", True, False),
        ("busy", False, False),
        ("idle", False, False),
        ("idle", False, False),
    ]
    assert [presentation.state(by_id[key]) for key in ids(agents)] == [
        "waiting",
        "done",
        "working",
        "working",
        "quiet",
        "quiet",
    ]
    assert presentation.state_label(by_id["working-again"]) == "working · result unseen"
    assert presentation.state_label(by_id["working"]) == "working"
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


def test_focused_work_titles_a_session_without_changing_the_persons_name(world):
    bundle = world.task("202601010000-thing", "Status: in-progress\nCreated: x\n\n# Build the thing\n")
    world.add("tasked", "%1", focus={"bundle": bundle, "taskId": "202601010000-thing"})
    world.add("missing", "%2", focus={"bundle": "/nowhere/x", "taskId": "202601010000-gone"})
    world.add("named", "%3", name="Thing builder", focus={"bundle": bundle, "taskId": "202601010000-thing"})

    by_id = {agent.session_id: agent for agent in model.live()}
    assert (by_id["tasked"].title, by_id["tasked"].task.status) == ("Build the thing", "in-progress")
    assert by_id["missing"].title == "202601010000-gone"
    assert by_id["named"].name == "Thing builder"
    assert by_id["named"].title == "Build the thing"


def card_text(app):
    return {
        card.agent.session_id: {
            "lane": card.parent.id,
            "title": Content.from_markup(str(card.border_title)).plain,
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
        focus={"bundle": bundle, "taskId": "202601010000-login"},
        model="claude",
        context_tokens=120_000,
        cost=1.25,
    )
    world.add("finished", "%2", name="Finished work", needs_you_since=now - 10)
    world.add("again", "%3", "thinking", name="Working again", needs_you_since=now - 20)

    async def run():
        app = sidebar.Sidebar()
        async with app.run_test(size=(60, 50)) as pilot:
            await pilot.pause(0.5)
            return card_text(app), str(app.query_one("#hero-count").value)

    cards, count = asyncio.run(run())
    assert cards["worker"]["lane"] == "lane-work"
    assert "Fix the login bug" in cards["worker"]["title"]
    assert cards["worker"]["task"] == "◆ Login fixer in-progress"
    assert cards["worker"]["act"] == "bash npm test"
    assert cards["worker"]["meta"] == "120k $1.25"
    assert cards["finished"]["lane"] == "lane-need" and "✓" in cards["finished"]["title"]
    # Working again after an unseen settle: in the working lane, its spinner followed by the unseen tick.
    assert cards["again"]["lane"] == "lane-work" and "✓ Working again" in cards["again"]["title"]
    assert "✓" not in cards["worker"]["title"]
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


def test_views_show_explicit_focus_and_ignore_historical_guessed_intent(world):
    bundle = world.task("202601010000-login", "Status: in-progress\n\n# Fix the login bug\n")
    world.add("stated", "%1", name="Ada Lovejoy", intent="Fixing the CSV parser crash")
    world.add(
        "tasked",
        "%2",
        name="Kofi Marchetti",
        intent="Reading the billing code",
        focus={"bundle": bundle, "taskId": "202601010000-login"},
    )
    world.add("neither", "%3", name="Orla Brannigan", cwd="/repo/app")

    async def run():
        app = sidebar.Sidebar()
        async with app.run_test(size=(60, 50)) as pilot:
            await pilot.pause(0.5)
            return card_text(app)

    cards = asyncio.run(run())
    assert cards["stated"]["task"] == "◇ no focused task · project"
    assert "Fix the login bug" in cards["tasked"]["title"]
    assert cards["tasked"]["task"] == "◆ Kofi Marchetti in-progress"
    assert cards["neither"]["task"] == "◇ no focused task · app"

    now = time.time()
    by_id = {agent.session_id: agent for agent in model.live()}
    assert str(dashboard.cells(by_id["stated"], now, 0)["task"]) == ""
    assert str(dashboard.cells(by_id["tasked"], now, 0)["task"]) == "Fix the login bug"


def test_a_database_an_older_runtime_has_not_migrated_yet_still_lists_its_sessions(world):
    world.add("old", "%1", name="Older")
    world.execute("drop table work_focus")
    world.execute("drop table work_tasks")
    agents = model.live()
    assert [(agent.session_id, agent.task) for agent in agents] == [("old", None)]


def test_an_organization_is_drawn_as_a_tree_with_role_titles_and_its_former_members_folded(world):
    world.add("root", "%1", name="Ada Lovejoy")
    world.add("manager", "%2", "thinking", name="Kofi Marchetti", reports_to="root", role_title="Coordinator")
    world.add("person-a", "%3", name="Orla Brannigan", reports_to="manager", role_title="Staff Engineer, Simplicity")
    world.add("person-b", "%4", name="Ravi Okonkwo", reports_to="manager", role_title="Architecture Prosecutor")
    world.add("lone", "%5", name="Mina Castellano")
    world.add("gone", None, name="Theo Lindqvist", reports_to="manager", role_title="Technical Writer")
    world.execute("update sessions set retired_at = 1, retired_reason = 'the burst passed' where id = 'gone'")

    agents = model.live()
    assert [[a.session_id for a in members] for members in model.trees(agents)] == [
        ["root", "manager", "person-a", "person-b"],
        ["lone"],
    ]
    assert [a.depth for a in model.trees(agents)[0]] == [0, 1, 2, 2]
    assert [person.session_id for person in model.former(agents)["manager"]] == ["gone"]

    async def run():
        app = sidebar.Sidebar()
        async with app.run_test(size=(70, 60)) as pilot:
            await pilot.pause(0.5)
            before = (
                card_text(app),
                str(app.query_one(".former").shown),
                str(app.query_one("#head-org-root").border_title),
            )
            await pilot.press("f")
            await pilot.pause(0.2)
            margins = {card.agent.session_id: card.styles.margin.left for card in app.query(sidebar.Card)}
            return before, str(app.query_one(".former").shown), margins, [a.session_id for a in app.agents]

    (cards, folded, head), opened, margins, order = asyncio.run(run())
    assert head == "ADA LOVEJOY · 3 people"
    assert {sid: card["lane"] for sid, card in cards.items()} == {
        "root": "lane-org-root",
        "manager": "lane-org-root",
        "person-a": "lane-org-root",
        "person-b": "lane-org-root",
        "lone": "lane-quiet",
    }
    assert "Coordinator" in cards["manager"]["title"] and "Staff Engineer, Simplicity" in cards["person-a"]["title"]
    assert margins == {"root": 0, "manager": 2, "person-a": 4, "person-b": 4, "lone": 0}
    assert folded == "▸ 1 former member"
    assert opened == "▸ 1 former member".replace("▸", "▾") + "\n  Theo Lindqvist · Technical Writer · the burst passed"
    assert order == ["root", "manager", "person-a", "person-b", "lone"]


def test_a_database_without_the_organization_columns_draws_every_session_on_its_own(world):
    world.add("old", "%1", name="Older")
    for column in ("role", "role_title", "reports_to", "retired_at", "retired_reason"):
        world.execute(f"alter table sessions drop column {column}")
    agents = model.live()
    assert [(agent.session_id, agent.role, agent.reports_to) for agent in agents] == [("old", "", "")]
    assert model.trees(agents) == [[agents[0]]] and model.former(agents) == {}
