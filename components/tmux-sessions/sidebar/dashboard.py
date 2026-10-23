#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["textual==8.2.8"]
# ///
"""Pi agent dashboard: a tmux window with every root Pi agent in a table and a live view of the selected one.

Organizations come first, each root followed by its people indented under their managers with their role titles;
sessions on their own follow in arrival order."""

from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from model import Agent, Store, live, mark_seen, talk, tmux, trees  # noqa: E402
from presentation import (  # noqa: E402
    STATUS_STYLE,
    ago,
    count_of,
    details,
    glyph,
    show,
    state,
    state_label,
    tokens,
    unseen_while_working,
    use_theme,
)
from rich.text import Text  # noqa: E402
from textual import on, work  # noqa: E402
from textual.app import App, ComposeResult  # noqa: E402
from textual.binding import Binding  # noqa: E402
from textual.containers import Horizontal, Vertical  # noqa: E402
from textual.content import Content  # noqa: E402
from textual.widgets import DataTable, Input, Sparkline, Static  # noqa: E402

POLL_SECONDS = 1.0
PREVIEW_SECONDS = 0.5
TICK_SECONDS = 0.25
# Reading a finished agent's pane in the preview for this long counts as having seen it.
SEEN_AFTER_SECONDS = 3.0
# Below this width the live view would be too narrow beside the full table, so it goes underneath.
NARROW_COLUMNS = 180
COLUMNS = (
    ("state", " ", 1),
    ("name", "Agent", 26),
    ("role", "Role", 20),
    ("task", "Working on", 24),
    ("doing", "Doing", 30),
    ("age", "For", 4),
    ("context", "Context", 7),
    ("cost", "Cost", 8),
)


def cells(agent: Agent, now: float, frame: int) -> dict[str, Text]:
    current = state(agent)
    quiet = "#7f849c" if current == "quiet" else ""
    act = agent.activity
    return {
        "state": Text(glyph(agent, frame), style=f"bold {STATUS_STYLE[current]}")
        + Text("✓" if unseen_while_working(agent) else "", style=f"bold {STATUS_STYLE['done']}"),
        "name": Text(
            "  " * agent.depth + agent.name, style=f"bold {STATUS_STYLE[current]}" if agent.needs_you else quiet
        ),
        "role": Text(agent.role, style=quiet or "#7f849c"),
        "task": Text(agent.task.title, style=quiet or "#fab387") if agent.task else Text("", style="#7f849c"),
        "doing": Text(f"{act.last_tool} {act.last_tool_detail}".strip(), style=quiet),
        "age": Text(ago(agent.updated_at, now), style="#7f849c"),
        "context": Text(tokens(act.context_tokens) if act.model else "", style=quiet, justify="right"),
        "cost": Text(f"${act.cost:.2f}" if act.model else "", style=quiet, justify="right"),
    }


class Dashboard(App):
    CSS = """
    Screen { background: ansi_default; }
    Static { text-wrap: nowrap; text-overflow: ellipsis; }
    #header { height: 1; padding: 0 1; margin-bottom: 1; }
    #body { height: 1fr; }
    #body.-narrow { layout: vertical; }
    #table { width: auto; max-width: 65%; height: 1fr; background: ansi_default; border: round $panel;
             border-title-color: $text-muted; border-title-style: bold; }
    #table:focus { border: round $accent; }
    #table > .datatable--header { background: ansi_default; color: $text-muted; text-style: bold; }
    #table > .datatable--header-hover { background: ansi_default; }
    #body.-narrow #table { width: 1fr; max-width: 100%; height: 2fr; }
    #side { width: 1fr; height: 1fr; }
    #body.-narrow #side { width: 1fr; height: 3fr; }
    #detail { height: auto; border: round $panel; padding: 0 1; border-title-color: $text-muted; }
    #detail.-waiting { border: round $warning; border-title-color: $text-warning; }
    #detail.-done { border: round $success; border-title-color: $text-success; }
    #detail.-working { border: round $primary; border-title-color: $text-primary; }
    #spark { height: 1; margin: 0 1; }
    #spark > .sparkline--min-color { color: $panel; }
    #spark > .sparkline--max-color { color: $primary; }
    #preview { height: 1fr; border: round $panel; padding: 0 1; overflow: hidden;
               border-title-color: $text-muted; border-subtitle-color: $text-muted; }
    #empty { margin: 2 4; color: $text-muted; text-wrap: wrap; }
    #reply { dock: bottom; display: none; border: round $accent; background: ansi_default; }
    #reply.-open { display: block; }
    #keys { dock: bottom; height: 1; color: $text-muted; padding: 0 1; }
    .-preview-only #table { display: none; }
    """

    BINDINGS = [
        Binding("j", "cursor(1)", "next", show=False),
        Binding("k", "cursor(-1)", "previous", show=False),
        Binding("x", "seen", "mark seen", show=False),
        Binding("X", "seen_all", "mark all seen", show=False),
        Binding("r", "reply", "reply", show=False),
        Binding("p", "preview_only", "preview only", show=False),
        Binding("escape", "back", "back", show=False),
        Binding("q", "quit", "close", show=False),
    ]

    def __init__(self) -> None:
        # Keep the terminal's own (possibly translucent) background; see the sidebar for why ansi_color is needed.
        super().__init__(ansi_color=True)
        self.store = Store()
        self.lock = threading.Lock()
        self.agents: list[Agent] = []
        self.order: list[str] = []
        self.selected: str | None = None
        self.selected_since = 0.0
        self.frame = 0
        self.watched = True
        self.shown_cells: dict[tuple[str, str], Text] = {}
        self.shown_screen: tuple[str, str, int] | None = None
        self.last_error = ""

    def compose(self) -> ComposeResult:
        yield Static(id="header")
        with Horizontal(id="body"):
            yield DataTable(id="table", cursor_type="row", zebra_stripes=False)
            with Vertical(id="side"):
                yield Static(id="detail")
                yield Sparkline([], id="spark")
                yield Static(id="preview")
        yield Static("No Pi agents in tmux yet. Start pi in any pane and it appears here.", id="empty")
        yield Input(id="reply")
        yield Static(
            "j/k move · click or ⏎ jump · r reply · x seen · X all seen · p preview only · esc back · q close",
            id="keys",
        )

    def on_mount(self) -> None:
        use_theme(self)
        table = self.query_one(DataTable)
        table.border_title = "Agents"
        for key, label, width in COLUMNS:
            table.add_column(label, width=width, key=key)
        self.query_one("#preview").border_title = "Live view"
        self.poll()
        self.set_interval(POLL_SECONDS, self.poll)
        self.set_interval(PREVIEW_SECONDS, self.refresh_preview)
        self.set_interval(TICK_SECONDS, self.tick)
        self.on_resize()
        table.focus()

    def on_resize(self) -> None:
        self.query_one("#body").set_class(self.size.width < NARROW_COLUMNS, "-narrow")

    @work(thread=True)
    def poll(self) -> None:
        if not self.lock.acquire(blocking=False):
            return
        try:
            agents = self.store.poll()
        except Exception as error:  # noqa: BLE001 - a bad poll must not end an always-on dashboard
            self.call_from_thread(self.report, f"Could not read agents: {error}")
            return
        finally:
            self.lock.release()
        self.call_from_thread(self.apply, agents)

    def report(self, message: str) -> None:
        if message != self.last_error:
            self.last_error = message
            self.notify(message, severity="error", timeout=10)

    def apply(self, agents: list[Agent]) -> None:
        self.last_error = ""
        forest = trees(agents)
        agents = [agent for members in forest if len(members) > 1 for agent in members] + [
            members[0] for members in forest if len(members) == 1
        ]
        self.agents = agents
        now = time.time()
        table = self.query_one(DataTable)
        order = [agent.session_id for agent in agents]
        if order != self.order:
            table.clear()
            self.shown_cells = {}
            for agent in agents:
                row = cells(agent, now, self.frame)
                table.add_row(*(row[key] for key, _, _ in COLUMNS), key=agent.session_id)
                self.shown_cells.update({(agent.session_id, key): value for key, value in row.items()})
            self.order = order
            if self.selected in order:
                table.move_cursor(row=order.index(self.selected), animate=False)
        else:
            for agent in agents:
                for key, value in cells(agent, now, self.frame).items():
                    self.put_cell(agent.session_id, key, value)
        self.query_one("#empty").display = not agents
        self.query_one("#body").display = bool(agents)
        if agents and self.selected not in order:
            self.select(order[table.cursor_row] if table.cursor_row < len(order) else order[0])
        self.paint_header(now)
        self.paint_detail(now)

    def paint_header(self, now: float) -> None:
        agents = self.agents
        counts = {name: sum(state(agent) == name for agent in agents) for name in STATUS_STYLE}
        cost = sum(agent.activity.cost for agent in agents)
        parts = [Content.from_markup("[b]π agents[/b]")]
        for name, label, style in (
            ("waiting", "asking", "b $text-warning"),
            ("done", "done", "b $text-success"),
            ("working", "working", "$text-primary"),
            ("quiet", "idle", "$text-muted"),
        ):
            glyph_text = {"waiting": "?", "done": "✓", "working": "⠿", "quiet": "·"}[name]
            parts.append(
                Content.from_markup(
                    f"[{style if counts[name] else '$text-muted'}]$glyph $count $label[/]",
                    glyph=glyph_text,
                    count=counts[name],
                    label=label,
                )
            )
        parts.append(
            Content.from_markup(
                "[$text-muted]$total · $$$cost[/]", total=count_of(len(agents), "agent"), cost=f"{cost:.2f}"
            )
        )
        show(self.query_one("#header", Static), Content("   ").join(parts))

    def put_cell(self, session_id: str, key: str, value: Text) -> None:
        """Change one table cell only when its text changed: every update redraws the whole table."""
        if self.shown_cells.get((session_id, key)) != value:
            self.shown_cells[(session_id, key)] = value
            self.query_one(DataTable).update_cell(session_id, key, value)

    def selected_agent(self) -> Agent | None:
        return next((agent for agent in self.agents if agent.session_id == self.selected), None)

    def select(self, session_id: str) -> None:
        if session_id != self.selected:
            self.selected = session_id
            self.selected_since = time.time()
            self.paint_detail(time.time())
            self.refresh_preview()

    def paint_detail(self, now: float) -> None:
        agent = self.selected_agent()
        detail = self.query_one("#detail", Static)
        for name in ("waiting", "done", "working"):
            detail.set_class(agent is not None and state(agent) == name, f"-{name}")
        if agent is None:
            show(detail, "")
            return
        title = f"{glyph(agent, self.frame)} {state_label(agent)}"
        if detail.border_title != title:
            detail.border_title = title
        show(detail, details(agent, now))
        self.query_one(Sparkline).data = agent.spark(now)

    @on(DataTable.RowHighlighted)
    def highlighted(self, event: DataTable.RowHighlighted) -> None:
        # Rebuilding the rows highlights row 0 before the cursor returns to the selected agent; skip that stale one.
        if event.cursor_row == self.query_one(DataTable).cursor_row and event.row_key.value:
            self.select(event.row_key.value)

    @on(DataTable.RowSelected)
    def chosen(self, event: DataTable.RowSelected) -> None:
        agent = next((agent for agent in self.agents if agent.session_id == event.row_key.value), None)
        if agent:
            tmux("switch-client", "-t", agent.pane_id)
            tmux("select-window", "-t", agent.pane_id)
            tmux("select-pane", "-t", agent.pane_id)

    def tick(self) -> None:
        # Spinners animate only while someone can see them.
        if not self.watched:
            return
        self.frame += 1
        for agent in self.agents:
            if state(agent) == "working" and agent.session_id in self.order:
                self.put_cell(agent.session_id, "state", cells(agent, time.time(), self.frame)["state"])

    @work(thread=True, exclusive=True, group="preview")
    def refresh_preview(self) -> None:
        # Terminal focus alone is not enough: a dashboard in a window no client shows never gets a focus-out.
        own_window = tmux("display-message", "-p", "-t", os.environ.get("TMUX_PANE", ""), "#{window_id}").strip()
        watched = own_window in tmux("list-clients", "-F", "#{window_id}").split()
        agent = self.selected_agent()
        # An unwatched dashboard stops capturing panes; it catches up as soon as a client shows it again.
        screen = tmux("capture-pane", "-e", "-p", "-t", agent.pane_id) if agent and watched else ""
        self.call_from_thread(self.show_preview, agent, screen, watched)

    def show_preview(self, agent: Agent | None, screen: str, watched: bool) -> None:
        self.watched = watched
        if agent is None or not watched or agent.session_id != self.selected:
            return
        preview = self.query_one("#preview", Static)
        rows = max(1, preview.content_size.height)
        if (agent.session_id, screen, rows) != self.shown_screen:
            self.shown_screen = (agent.session_id, screen, rows)
            lines = screen.rstrip("\n").split("\n")[-rows:]
            preview.update(Text.from_ansi("\n".join(lines), no_wrap=True, overflow="crop"))
            preview.border_title = f"Live view · {agent.title}"
            preview.border_subtitle = f"{agent.tmux_session} {agent.window_index}.{agent.pane_index}"
        if agent.unseen and self.app_focus and time.time() - self.selected_since >= SEEN_AFTER_SECONDS:
            mark_seen(agent)
            self.poll()

    def action_cursor(self, step: int) -> None:
        table = self.query_one(DataTable)
        if self.order:
            table.move_cursor(row=(table.cursor_row + step) % len(self.order))

    def action_seen(self) -> None:
        agent = self.selected_agent()
        if agent:
            mark_seen(agent)
            self.poll()

    def action_seen_all(self) -> None:
        for agent in self.agents:
            mark_seen(agent)
        self.poll()

    def action_preview_only(self) -> None:
        self.screen.toggle_class("-preview-only")

    def action_reply(self) -> None:
        agent = self.selected_agent()
        if agent is None:
            return
        if agent.status != "idle":
            self.notify(f"{agent.name} is {state_label(agent)}; press enter to go to it.", timeout=4)
            return
        reply = self.query_one("#reply", Input)
        reply.border_title = f"Reply to {agent.name} · enter sends · esc cancels"
        reply.value = ""
        reply.add_class("-open")
        reply.focus()

    @on(Input.Submitted, "#reply")
    def send(self, event: Input.Submitted) -> None:
        agent = self.selected_agent()
        self.close_reply()
        text = event.value.strip()
        if agent is None or not text:
            return
        # Re-read the status: the agent may have started a turn while you typed.
        current = next((each for each in live() if each.session_id == agent.session_id), None)
        if current is None or current.status != "idle":
            self.notify(f"Not sent: {agent.name} is no longer waiting for input.", severity="warning")
            return
        self.deliver(current, text)

    @work(thread=True)
    def deliver(self, agent: Agent, text: str) -> None:
        failure = talk(agent, text)
        if failure:
            self.call_from_thread(
                self.notify, f"Not sent to {agent.name}: {failure}. Your text: {text}", severity="warning"
            )
        else:
            self.call_from_thread(self.notify, f"Sent to {agent.name}", timeout=3)

    def close_reply(self) -> None:
        reply = self.query_one("#reply", Input)
        reply.remove_class("-open")
        self.query_one(DataTable).focus()

    def action_back(self) -> None:
        if self.query_one("#reply").has_class("-open"):
            self.close_reply()
            return
        tmux("last-window")


if __name__ == "__main__":
    Dashboard().run()
