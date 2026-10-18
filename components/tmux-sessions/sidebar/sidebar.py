#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["textual==8.2.8"]
# ///
"""Pi agent sidebar: a live tmux pane that shows which root Pi agents need you, what each is, and what it does."""

from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from model import Agent, Store, mark_seen, tmux  # noqa: E402
from presentation import (  # noqa: E402
    STATES,
    activity,
    ago,
    count_of,
    glyph,
    show,
    state,
    task_line,
    tokens,
    use_theme,
)
from textual import work  # noqa: E402
from textual.app import App, ComposeResult  # noqa: E402
from textual.binding import Binding  # noqa: E402
from textual.containers import Horizontal, Vertical, VerticalScroll  # noqa: E402
from textual.content import Content  # noqa: E402
from textual.widget import Widget  # noqa: E402
from textual.widgets import Digits, Sparkline, Static  # noqa: E402

POLL_SECONDS = 1.0
TICK_SECONDS = 0.1
FLASH_SECONDS = 4.0
LANES = (
    ("need", "NEEDS YOU", lambda agent: agent.needs_you),
    ("work", "WORKING", lambda agent: not agent.needs_you and agent.status == "busy"),
    ("quiet", "QUIET", lambda agent: not agent.needs_you and agent.status != "busy"),
)


class Card(Widget):
    """One agent: border colour is its state, the title its name, the body its task and latest tool call."""

    def __init__(self, agent: Agent) -> None:
        super().__init__()
        self.agent = agent
        self.shown_title: Content | None = None
        self.shown_subtitle: Content | None = None

    def compose(self) -> ComposeResult:
        yield Static(classes="line task")
        yield Static(classes="line act")
        with Horizontal(classes="spark-row"):
            yield Sparkline([], classes="spark")
            yield Static(classes="meta")

    def on_mount(self) -> None:
        self.paint(time.time(), self.app.frame)

    def set_agent(self, agent: Agent, now: float, frame: int, selected: bool, flash: bool) -> None:
        self.agent = agent
        current = state(agent)
        for name in STATES:
            self.set_class(name == current, f"-{name}")
        self.set_class(selected, "-selected")
        self.set_class(flash, "-flash")
        if self.is_mounted:
            self.paint(now, frame)

    def paint(self, now: float, frame: int) -> None:
        agent = self.agent
        self.paint_title(frame)
        where = f"{agent.tmux_session} {agent.window_index}.{agent.pane_index} · {ago(agent.updated_at, now)}"
        subtitle = (
            Content.from_markup("[b $text-accent]◂ here[/]  $where", where=where)
            if agent.focused
            else Content.from_markup("$where", where=where)
        )
        if subtitle != self.shown_subtitle:
            self.shown_subtitle = self.border_subtitle = subtitle
        show(self.query_one(".task", Static), task_line(agent))
        show(self.query_one(".act", Static), activity(agent))
        spark = agent.spark(now)
        self.set_class(not any(spark), "-flat")
        self.query_one(Sparkline).data = spark
        act = agent.activity
        show(self.query_one(".meta", Static), f"{tokens(act.context_tokens)} ${act.cost:.2f}" if act.model else "")

    def paint_title(self, frame: int) -> None:
        title = Content.from_markup("[b]$glyph  $name[/b]", glyph=glyph(self.agent, frame), name=self.agent.name)
        if title != self.shown_title:
            self.shown_title = self.border_title = title

    def tick(self, frame: int) -> None:
        if state(self.agent) == "working":
            self.paint_title(frame)

    def on_click(self) -> None:
        self.app.jump(self.agent)


class Sidebar(App):
    CSS = """
    Screen { background: ansi_default; }
    Static { text-wrap: nowrap; text-overflow: ellipsis; }
    #keys { dock: bottom; height: 1; color: $text-muted; content-align: center middle; }
    App:blur #keys { display: none; }

    #hero { height: 3; margin: 1 1 0 1; }
    #hero-count { width: auto; color: $warning; }
    #hero-count.-clear { color: $success; }
    #hero-label { width: 1fr; height: 3; padding-left: 2; content-align: left middle; }
    #lanes { scrollbar-size-vertical: 1; }
    #empty { margin: 2 2; color: $text-muted; text-wrap: wrap; }
    .lane-head { height: 1; margin: 1 0; border-top: heavy $panel; border-title-align: left;
                 border-title-style: bold; border-title-color: $text-muted; }
    #head-need { border-top: heavy $warning; border-title-color: $text-warning; }
    #head-work { border-top: heavy $primary; border-title-color: $text-primary; }
    .lane { height: auto; }

    Card { height: auto; border: round $panel; border-title-color: $text; border-subtitle-color: $text-muted;
           padding: 0 1; }
    Card:hover { background: $surface; }
    Card .line, Card .spark-row { height: 1; }
    Card .spark { width: 1fr; }
    Card .meta { width: auto; padding-left: 1; color: $text-muted; }
    Card.-waiting { border: round $warning; border-title-color: $text-warning; }
    Card.-done { border: round $success; border-title-color: $text-success; }
    Card.-working { border: round $primary; border-title-color: $text-primary; }
    Card.-quiet { color: $text-muted; }
    Card.-quiet .spark-row, Card.-flat .spark-row { display: none; }
    Card.-flash { border: heavy $warning-lighten-2; }
    Card.-done.-flash { border: heavy $success-lighten-2; }
    App:focus Card.-selected { border-title-background: $foreground; border-title-color: $background; }
    """

    BINDINGS = [
        Binding("j,down", "move(1)", "next", show=False),
        Binding("k,up", "move(-1)", "previous", show=False),
        Binding("enter", "jump", "jump", show=False),
        Binding("x", "seen", "mark seen", show=False),
        Binding("X", "seen_all", "mark all seen", show=False),
        Binding("escape", "leave", "back", show=False),
        Binding("q", "close", "close", show=False),
    ]

    def __init__(self) -> None:
        # Paint the terminal's own default background: a theme colour would show as an opaque slab on a
        # translucent terminal, and Textual only keeps `ansi_default` when ANSI colours are allowed.
        super().__init__(ansi_color=True)
        self.store = Store()
        self.lock = threading.Lock()
        self.agents: list[Agent] = []
        self.selected: str | None = None
        self.frame = 0
        self.previous_states: dict[str, str] = {}
        self.flash_until: dict[str, float] = {}
        self.last_error = ""

    def compose(self) -> ComposeResult:
        with Horizontal(id="hero"):
            yield Digits("0", id="hero-count")
            yield Static(id="hero-label")
        with VerticalScroll(id="lanes"):
            for key, _, _ in LANES:
                yield Static(classes="lane-head", id=f"head-{key}")
                yield Vertical(classes="lane", id=f"lane-{key}")
            yield Static("No Pi agents in tmux yet. Start pi in any pane and it appears here.", id="empty")
        yield Static("j/k move · ⏎ jump · x seen · esc back · q close", id="keys")

    def on_mount(self) -> None:
        use_theme(self)
        self.poll()
        self.set_interval(POLL_SECONDS, self.poll)
        self.set_interval(TICK_SECONDS, self.tick)

    @work(thread=True)
    def poll(self) -> None:
        if not self.lock.acquire(blocking=False):
            return
        try:
            agents = self.store.poll()
        except Exception as error:  # noqa: BLE001 - a bad poll must not end an always-on sidebar
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
        now = time.time()
        self.last_error = ""
        live = {agent.session_id for agent in agents}
        self.previous_states = {sid: s for sid, s in self.previous_states.items() if sid in live}
        self.flash_until = {sid: until for sid, until in self.flash_until.items() if sid in live and until > now}
        for agent in agents:
            current = state(agent)
            before = self.previous_states.get(agent.session_id)
            if before is not None and before != current and current in ("waiting", "done"):
                self.flash_until[agent.session_id] = now + FLASH_SECONDS
            self.previous_states[agent.session_id] = current
        self.agents = agents
        ids = [agent.session_id for agent in agents]
        if self.selected not in ids:
            self.selected = ids[0] if ids else None
        self.render_agents()

    def flashing(self, agent: Agent, now: float) -> bool:
        return now < self.flash_until.get(agent.session_id, 0) and (self.frame // 3) % 2 == 0

    def render_agents(self) -> None:
        agents = self.agents
        need = sum(agent.needs_you for agent in agents)
        working = sum(agent.status == "busy" and not agent.needs_you for agent in agents)
        count = self.query_one("#hero-count", Digits)
        count.update(str(need))
        count.set_class(need == 0, "-clear")
        self.query_one("#hero-label", Static).update(
            Content.from_markup(
                "[b $text-warning]need you[/]\n[$text-muted]$working working · $quiet quiet[/]",
                working=working,
                quiet=len(agents) - need - working,
            )
            if need
            else Content.from_markup(
                "[b $text-success]all clear[/]\n[$text-muted]$working working · $total[/]",
                working=working,
                total=count_of(len(agents), "agent"),
            )
        )
        self.query_one("#empty").display = not agents
        now = time.time()
        for key, title, belongs in LANES:
            members = [agent for agent in agents if belongs(agent)]
            head = self.query_one(f"#head-{key}", Static)
            head.border_title = f"{title} · {len(members)}"
            head.display = bool(members)
            self.sync_lane(self.query_one(f"#lane-{key}", Vertical), members, now)

    def sync_lane(self, lane: Vertical, members: list[Agent], now: float) -> None:
        """Hold exactly one card per member, in member order, updated in place."""
        cards = {child.agent.session_id: child for child in lane.children if isinstance(child, Card)}
        wanted = {agent.session_id for agent in members}
        for session_id, card in cards.items():
            if session_id not in wanted:
                card.remove()
        for index, agent in enumerate(members):
            card = cards.get(agent.session_id)
            if card is None:
                card = cards[agent.session_id] = Card(agent)
                lane.mount(card)
            card.set_agent(agent, now, self.frame, agent.session_id == self.selected, self.flashing(agent, now))
            if lane.children.index(card) != index:
                lane.move_child(card, before=index)

    def tick(self) -> None:
        self.frame += 1
        now = time.time()
        if self.frame % 3 == 0 and any(now < until + TICK_SECONDS * 3 for until in self.flash_until.values()):
            self.render_agents()
            return
        for card in self.query(Card):
            card.tick(self.frame)

    def selected_agent(self) -> Agent | None:
        return next((agent for agent in self.agents if agent.session_id == self.selected), None)

    def action_move(self, step: int) -> None:
        ids = [agent.session_id for agent in self.agents]
        if not ids:
            return
        index = ids.index(self.selected) if self.selected in ids else 0
        self.selected = ids[(index + step) % len(ids)]
        self.render_agents()
        for card in self.query(Card):
            if card.agent.session_id == self.selected:
                card.scroll_visible()

    def action_jump(self) -> None:
        agent = self.selected_agent()
        if agent:
            self.jump(agent)

    def action_seen(self) -> None:
        agent = self.selected_agent()
        if agent is None:
            return
        mark_seen(agent)
        # Inbox behaviour: the cursor stays in place and lands on the next agent, not on the one that sank.
        ids = [each.session_id for each in self.agents]
        index = ids.index(agent.session_id)
        rest = ids[index + 1 :] or ids[:index]
        self.selected = rest[0] if rest else agent.session_id
        self.poll()

    def action_seen_all(self) -> None:
        for agent in self.agents:
            mark_seen(agent)
        self.poll()

    def action_leave(self) -> None:
        tmux("select-pane", "-l")

    def action_close(self) -> None:
        tmux("kill-pane", "-t", os.environ.get("TMUX_PANE", ""))

    def jump(self, agent: Agent) -> None:
        tmux("switch-client", "-t", agent.pane_id)
        tmux("select-window", "-t", agent.pane_id)
        tmux("select-pane", "-t", agent.pane_id)
        self.poll()


if __name__ == "__main__":
    Sidebar().run()
