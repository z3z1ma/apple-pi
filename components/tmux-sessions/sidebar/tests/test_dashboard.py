"""Behaviour of the agent dashboard: attention-ordered table, live view, jump, reply, and seen-by-reading."""

import asyncio
import time

import dashboard
from textual.widgets import DataTable


def run(app_test):
    return asyncio.run(app_test())


def setup_agents(world):
    now = time.time()
    world.add("asking", "%1", "running_tool", name="Needs an answer", prompt={"id": "q1"}, needs_you_since=now - 300)
    world.add("busy", "%2", "thinking", name="Still going", updated_at=now - 30)
    world.add("quiet", "%3", name="Long done", updated_at=now - 900)
    world.tmux.screens = {"%1": "\x1b[1mWhich option?\x1b[0m\n> ", "%3": "all finished\n"}
    return world.tmux


def test_table_lists_agents_in_arrival_order_and_previews_the_selected_pane(world):
    setup_agents(world)

    async def scenario():
        app = dashboard.Dashboard()
        async with app.run_test(size=(200, 50)) as pilot:
            await pilot.pause(0.8)
            rows = [row.value for row in app.query_one(DataTable).rows]
            preview = str(app.query_one("#preview").render())
            await pilot.press("j")
            await pilot.pause(0.8)
            return rows, preview, app.selected

    rows, preview, selected = run(scenario)
    assert rows == ["asking", "busy", "quiet"]
    assert "Which option?" in preview
    assert selected == "busy"


def test_the_live_view_is_titled_by_focus_but_replies_address_the_person(world):
    bundle = world.task("202601010000-verify", "# Verify the release\n\nStatus: in-progress\n")
    world.add("alice", "%1", name="Alice", focus={"bundle": bundle, "taskId": "202601010000-verify"})

    async def scenario():
        app = dashboard.Dashboard()
        async with app.run_test(size=(200, 50)) as pilot:
            await pilot.pause(0.8)
            title = str(app.query_one("#preview").border_title)
            await pilot.press("r")
            await pilot.pause(0.2)
            return title, str(app.query_one("#reply").border_title)

    title, reply = run(scenario)
    assert "Verify the release" in title
    assert "Reply to Alice" in reply


def test_enter_jumps_to_the_selected_agent(world):
    fake = setup_agents(world)

    async def scenario():
        app = dashboard.Dashboard()
        async with app.run_test(size=(200, 50)) as pilot:
            await pilot.pause(0.8)
            await pilot.press("enter")
            await pilot.pause(0.2)

    run(scenario)
    assert ("switch-client", "-t", "%1") in fake.commands
    assert ("select-pane", "-t", "%1") in fake.commands


def test_reply_sends_talk_to_an_idle_agent_and_offers_none_to_a_busy_one(world):
    fake = setup_agents(world)

    async def scenario():
        app = dashboard.Dashboard()
        async with app.run_test(size=(200, 50)) as pilot:
            await pilot.pause(0.8)
            await pilot.press("j", "r")
            await pilot.pause(0.2)
            busy_reply_open = app.query_one("#reply").has_class("-open")
            await pilot.press("j", "r")
            await pilot.pause(0.2)
            await pilot.press(*"go on", "enter")
            await pilot.pause(0.3)
            return busy_reply_open

    assert run(scenario) is False
    assert world.runtime.commands() == [("quiet", {"kind": "talk", "text": "go on"})]
    assert not [command for command in fake.commands if command[0] == "send-keys"]


def test_a_reply_the_runtime_refuses_says_why_and_keeps_your_text(world):
    setup_agents(world)
    world.runtime.answer = {"stage": "failed", "reason": "busy: send steer or follow_up while a run is active"}

    async def scenario():
        app = dashboard.Dashboard()
        async with app.run_test(size=(200, 50)) as pilot:
            await pilot.pause(0.8)
            await pilot.press("j", "j", "r")
            await pilot.pause(0.2)
            await pilot.press(*"go on", "enter")
            await pilot.pause(0.5)
            return [notice.message for notice in app._notifications]

    notices = run(scenario)
    assert any("busy: send steer" in message and "go on" in message for message in notices)


def test_reading_a_finished_agent_in_the_live_view_marks_it_seen(world, monkeypatch):
    world.add("done", "%1", name="Finished", needs_you_since=time.time() - 60)
    monkeypatch.setattr(dashboard, "SEEN_AFTER_SECONDS", 0.3)

    async def scenario():
        app = dashboard.Dashboard()
        async with app.run_test(size=(200, 50)) as pilot:
            await pilot.pause(1.5)

    run(scenario)
    assert ("done", {"kind": "mark_seen"}) in world.runtime.commands()


def test_a_reply_is_not_sent_when_the_agent_starts_working_while_you_type(world):
    fake = setup_agents(world)

    async def scenario():
        app = dashboard.Dashboard()
        async with app.run_test(size=(200, 50)) as pilot:
            await pilot.pause(0.8)
            await pilot.press("j", "j", "r")
            await pilot.pause(0.2)
            await pilot.press(*"hello")
            world.execute("update sessions set run_state = 'thinking' where id = 'quiet'")
            await pilot.press("enter")
            await pilot.pause(0.3)
            return [notice.message for notice in app._notifications]

    notices = run(scenario)
    assert not [command for command in fake.commands if command[0] == "send-keys"]
    assert world.runtime.commands() == []
    assert any("Not sent" in message for message in notices)


def test_wide_windows_put_the_live_view_beside_the_table_narrow_ones_below_and_p_gives_it_the_width(world):
    setup_agents(world)

    async def layout(width: int, height: int, keys: tuple[str, ...] = ()):
        app = dashboard.Dashboard()
        async with app.run_test(size=(width, height)) as pilot:
            await pilot.pause(0.8)
            await pilot.press(*keys)
            await pilot.pause(0.3)
            table, preview = app.query_one(DataTable), app.query_one("#preview")
            return table.display, table.region, preview.region

    _, table, preview = asyncio.run(layout(200, 50))
    assert preview.x > table.x + table.width - 1 and preview.y < table.y + table.height
    _, table, preview = asyncio.run(layout(120, 45))
    assert preview.y >= table.y + table.height
    shown, _, preview = asyncio.run(layout(200, 50, ("p",)))
    assert not shown and preview.width >= 196


def test_a_dashboard_no_client_is_showing_marks_nothing_seen(world, monkeypatch):
    world.tmux.watched = False
    world.add("done", "%1", name="Finished", needs_you_since=time.time() - 60)
    monkeypatch.setattr(dashboard, "SEEN_AFTER_SECONDS", 0.3)

    async def scenario():
        app = dashboard.Dashboard()
        async with app.run_test(size=(200, 50)) as pilot:
            await pilot.pause(1.5)

    run(scenario)
    assert world.runtime.commands() == []


def test_table_draws_organizations_first_as_indented_trees_with_role_titles(world):
    now = time.time()
    world.add("lone", "%1", "thinking", name="Mina Castellano", updated_at=now - 10)
    world.add("root", "%2", name="Ada Lovejoy", updated_at=now - 900)
    world.add("manager", "%3", name="Kofi Marchetti", reports_to="root", role_title="Coordinator")
    world.add("person", "%4", name="Orla Brannigan", reports_to="manager", role_title="Technical Writer")

    async def scenario():
        app = dashboard.Dashboard()
        async with app.run_test(size=(200, 50)) as pilot:
            await pilot.pause(0.8)
            table = app.query_one(DataTable)
            return [
                (row.value, str(table.get_cell(row.value, "name")), str(table.get_cell(row.value, "role")))
                for row in table.rows
            ]

    assert run(scenario) == [
        ("root", "Ada Lovejoy", ""),
        ("manager", "  Kofi Marchetti", "Coordinator"),
        ("person", "    Orla Brannigan", "Technical Writer"),
        ("lone", "Mina Castellano", ""),
    ]
