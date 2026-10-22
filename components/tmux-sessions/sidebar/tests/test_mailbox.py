"""Operator mail is a threaded inbox, independent of session prompts and attention."""

import asyncio

import mailbox_view
import sidebar
from textual.widgets import Button, ListView, TextArea


def conversation(world):
    world.add("writer", "%1", name="Ada")
    world.execute(
        "insert into threads (id, kind, subject, created_by, created_at) values ('approval', 'mail', 'Release approval', 'writer', 1)"
    )
    for person in ("writer", "operator"):
        world.execute(
            "insert into thread_participants (thread_id, participant, delivery, read_up_to, joined_at) values ('approval', ?, 'push', 0, 1)",
            person,
        )
    world.execute(
        "insert into thread_messages (id, thread_id, sender, body, at) values ('message-1', 'approval', 'writer', 'May we release?', 2)"
    )


def test_operator_unread_is_derived_from_its_cursor_and_the_old_schema_is_safe(world):
    conversation(world)
    assert mailbox_view.operator_threads() == [
        {"id": "approval", "subject": "Release approval", "last_at": 2, "unread": 1}
    ]
    assert mailbox_view.read_thread("missing") is None
    world.execute("update thread_participants set read_up_to = 1 where participant = 'operator'")
    assert mailbox_view.operator_threads()[0]["unread"] == 0
    world.execute("drop table thread_messages")
    assert mailbox_view.operator_threads() == []
    assert mailbox_view.read_thread("approval") is None


def test_sidebar_needs_you_mail_opens_a_thread_and_replies_as_the_operator(world):
    conversation(world)

    async def run():
        app = sidebar.Sidebar()
        async with app.run_test(size=(50, 50)) as pilot:
            await pilot.pause(0.5)
            assert str(app.query_one("#mail", Button).label) == "Mail: 1 need you"
            await pilot.press("m")
            await pilot.pause(0.3)
            app.screen.query_one(ListView).focus()
            await pilot.press("enter")
            await pilot.pause(0.3)
            assert "May we release?" in str(app.screen.query_one("#mail-body").render())
            app.screen.query_one(TextArea).load_text("Approved. Keep the rollback ready.")
            await pilot.click("#mail-send")
            await pilot.pause(0.3)
            return world.runtime.commands(), world.runtime.lines

    commands, lines = asyncio.run(run())
    assert ("operator", {"kind": "thread_read", "thread": "approval", "seq": 1}) in commands
    assert (
        "operator",
        {"kind": "thread_post", "thread": "approval", "body": "Approved. Keep the rollback ready."},
    ) in commands
    assert all("generation" not in line for line in lines)
    assert not any(command["kind"] == "talk" for _, command in commands)
