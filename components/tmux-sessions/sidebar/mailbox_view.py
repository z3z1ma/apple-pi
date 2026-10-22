"""The operator's inbox: read threads and send replies through the runtime, never session prompts."""

from __future__ import annotations

import asyncio
from datetime import datetime

from model import connect, send_as
from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen
from textual.widgets import Button, Label, ListItem, ListView, Static, TextArea

OPERATOR = "operator"


def operator_threads() -> list[dict]:
    db = connect()
    if db is None:
        return []
    try:
        if not db.execute("select 1 from sqlite_master where name = 'thread_messages'").fetchone():
            return []
        return [
            dict(row)
            for row in db.execute(
                """
            select t.id, t.subject, max(m.at) as last_at,
                count(case when m.seq > p.read_up_to and m.sender != ? then 1 end) as unread
            from threads t join thread_participants p on p.thread_id = t.id and p.participant = ?
            join thread_messages m on m.thread_id = t.id group by t.id order by last_at desc
        """,
                (OPERATOR, OPERATOR),
            )
        ]
    finally:
        db.close()


def read_thread(thread: str) -> dict | None:
    db = connect()
    if db is None:
        return None
    try:
        if not db.execute("select 1 from sqlite_master where name = 'thread_messages'").fetchone():
            return None
        row = db.execute(
            """select t.subject, t.closed_at from threads t join thread_participants p on p.thread_id = t.id
            where t.id = ? and p.participant = ?""",
            (thread, OPERATOR),
        ).fetchone()
        if row is None:
            return None
        messages = [
            dict(m)
            for m in db.execute(
                """
            select m.seq, coalesce(s.name, m.sender) as name, m.body, m.at from thread_messages m
            left join sessions s on s.id = m.sender where m.thread_id = ? order by m.seq
        """,
                (thread,),
            )
        ]
        return {"id": thread, "subject": row["subject"], "closed": row["closed_at"] is not None, "messages": messages}
    finally:
        db.close()


class Mailbox(ModalScreen):
    CSS = """
    Mailbox { align: center middle; }
    #mail-dialog { width: 100%; height: 95%; background: $surface; border: round $primary; padding: 1; }
    #mail-threads { height: 25%; min-height: 3; }
    #mail-history { height: 1fr; }
    #mail-body { height: auto; text-wrap: wrap; text-overflow: fold; }
    #mail-reply { height: 5; }
    #mail-buttons { height: auto; }
    #mail-buttons Button { min-width: 8; width: 1fr; }
    #mail-error { height: auto; color: $error; text-wrap: wrap; }
    """
    BINDINGS = [("escape", "dismiss", "Back")]

    def __init__(self) -> None:
        super().__init__()
        self.threads: list[dict] = []
        self.thread: dict | None = None
        self.drafts: dict[str, str] = {}

    def compose(self) -> ComposeResult:
        with Vertical(id="mail-dialog"):
            yield Label("Your inbox")
            yield ListView(id="mail-threads")
            with VerticalScroll(id="mail-history"):
                yield Static("Choose a conversation.", id="mail-body", markup=False)
            yield Label("Reply to everyone")
            yield TextArea(id="mail-reply", disabled=True)
            with Horizontal(id="mail-buttons"):
                yield Button("Send", id="mail-send", disabled=True)
                yield Button("Refresh", id="mail-refresh")
                yield Button("Back", id="mail-back")
            yield Static("", id="mail-error", markup=False)

    async def on_mount(self) -> None:
        await self.refresh_threads()

    async def refresh_threads(self) -> None:
        self.threads = operator_threads()
        view = self.query_one(ListView)
        await view.clear()
        await view.extend(ListItem(Label(f"{t['unread']} new | {t['subject']}", markup=False)) for t in self.threads)
        if self.threads:
            view.index = next(
                (i for i, thread in enumerate(self.threads) if self.thread and thread["id"] == self.thread["id"]), 0
            )

    async def on_list_view_selected(self, event: ListView.Selected) -> None:
        index = event.list_view.index
        if index is None:
            return
        if self.thread:
            self.drafts[self.thread["id"]] = self.query_one(TextArea).text
        await self.open_thread(self.threads[index]["id"])

    async def open_thread(self, thread_id: str) -> None:
        thread = read_thread(thread_id)
        if thread is None:
            self.query_one("#mail-error", Static).update("This thread is not in your inbox.")
            return
        self.thread = thread
        text = (
            thread["subject"]
            + "\n\n"
            + "\n\n".join(
                f"{m['name']} | {datetime.fromtimestamp(m['at'] / 1000).isoformat(sep=' ', timespec='seconds')}\n{m['body']}"
                for m in thread["messages"]
            )
        )
        self.query_one("#mail-body", Static).update(text)
        reply = self.query_one(TextArea)
        reply.load_text(self.drafts.get(thread_id, ""))
        reply.disabled = thread["closed"]
        self.query_one("#mail-send", Button).disabled = thread["closed"]
        if thread["messages"]:
            error = await asyncio.to_thread(
                send_as, OPERATOR, {"kind": "thread_read", "thread": thread_id, "seq": thread["messages"][-1]["seq"]}
            )
            self.query_one("#mail-error", Static).update(error or "")
        await self.refresh_threads()

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        event.stop()
        if event.button.id == "mail-back":
            self.dismiss()
        elif event.button.id == "mail-refresh":
            if self.thread:
                self.drafts[self.thread["id"]] = self.query_one(TextArea).text
                await self.open_thread(self.thread["id"])
            else:
                await self.refresh_threads()
        elif event.button.id == "mail-send" and self.thread:
            body = self.query_one(TextArea).text.strip()
            if not body:
                return
            event.button.disabled = True
            error = await asyncio.to_thread(
                send_as, OPERATOR, {"kind": "thread_post", "thread": self.thread["id"], "body": body}
            )
            event.button.disabled = False
            self.query_one("#mail-error", Static).update(error or "")
            if not error:
                self.drafts[self.thread["id"]] = ""
                await self.open_thread(self.thread["id"])
