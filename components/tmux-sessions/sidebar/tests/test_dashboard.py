"""Behaviour of the agent dashboard: attention-ordered table, live view, jump, reply, and seen-by-reading."""

import asyncio
import time

import dashboard
from conftest import record
from textual.widgets import DataTable


def run(app_test):
    return asyncio.run(app_test())


def setup_agents(env):
    fake, state, _, _ = env
    now = int(time.time())
    for pane in ("%1", "%2", "%3"):
        fake.add_pane(pane, seen_at=str(now - 600))
    record(state, "asking", "%1", "waiting", now - 300, name="Needs an answer")
    record(state, "busy", "%2", "busy", now - 30, name="Still going")
    record(state, "quiet", "%3", "idle", now - 900, name="Long done")
    fake.screens = {"%1": "\x1b[1mWhich option?\x1b[0m\n> ", "%3": "all finished\n"}
    return fake


def test_table_lists_agents_in_attention_order_and_previews_the_selected_pane(env):
    setup_agents(env)

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


def test_enter_jumps_to_the_selected_agent(env):
    fake = setup_agents(env)

    async def scenario():
        app = dashboard.Dashboard()
        async with app.run_test(size=(200, 50)) as pilot:
            await pilot.pause(0.8)
            await pilot.press("enter")
            await pilot.pause(0.2)

    run(scenario)
    assert ("switch-client", "-t", "%1") in fake.commands
    assert ("select-pane", "-t", "%1") in fake.commands


def test_reply_types_into_an_idle_agent_and_refuses_a_busy_one(env):
    fake = setup_agents(env)

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
    sent = [command for command in fake.commands if command[0] == "send-keys"]
    assert sent == [("send-keys", "-t", "%3", "-l", "--", "go on"), ("send-keys", "-t", "%3", "Enter")]


def test_reading_a_finished_agent_in_the_live_view_marks_it_seen(env, monkeypatch):
    fake, state, _, _ = env
    now = int(time.time())
    fake.add_pane("%1", seen_at=str(now - 600))
    record(state, "done", "%1", "idle", now - 60, name="Finished")
    monkeypatch.setattr(dashboard, "SEEN_AFTER_SECONDS", 0.3)

    async def scenario():
        app = dashboard.Dashboard()
        async with app.run_test(size=(200, 50)) as pilot:
            await pilot.pause(1.5)

    run(scenario)
    assert int(fake.panes["%1"]["seen"]) >= now


def test_a_reply_is_not_sent_when_the_agent_starts_working_while_you_type(env):
    fake = setup_agents(env)
    _, state, _, _ = env

    async def scenario():
        app = dashboard.Dashboard()
        async with app.run_test(size=(200, 50)) as pilot:
            await pilot.pause(0.8)
            await pilot.press("j", "j", "r")
            await pilot.pause(0.2)
            await pilot.press(*"hello")
            record(state, "quiet", "%3", "busy", int(time.time()), name="Long done")
            await pilot.press("enter")
            await pilot.pause(0.3)
            return [notice.message for notice in app._notifications]

    notices = run(scenario)
    assert not [command for command in fake.commands if command[0] == "send-keys"]
    assert any("Not sent" in message for message in notices)


def test_wide_windows_put_the_live_view_beside_the_table_narrow_ones_below_and_p_gives_it_the_width(env):
    setup_agents(env)

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
