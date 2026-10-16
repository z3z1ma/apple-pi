#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["textual==8.2.8"]
# ///
"""PROTOTYPE, throwaway: live Pi agent sidebar for a tmux pane.

Question: does a Textual sidebar in a real tmux pane answer "who needs me?", "which is which?",
and "what is it doing?" at a glance? The default merges B's count and lanes with A's cards; `v` or the
bottom pill switches to the original A Cards and B Lanes for comparison.
"""

from __future__ import annotations

import dataclasses
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from agents import Agent, AgentStore, tmux  # noqa: E402
from textual import work  # noqa: E402
from textual.app import App, ComposeResult  # noqa: E402
from textual.binding import Binding  # noqa: E402
from textual.containers import Horizontal, Vertical, VerticalScroll  # noqa: E402
from textual.content import Content  # noqa: E402
from textual.theme import BUILTIN_THEMES  # noqa: E402
from textual.widget import Widget  # noqa: E402
from textual.widgets import ContentSwitcher, Digits, Sparkline, Static  # noqa: E402

SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
POLL_SECONDS = 1.0
TICK_SECONDS = 0.1
FLASH_SECONDS = 4.0
VARIANTS = (("merged", "Cards in lanes"), ("cards", "A · Cards"), ("lanes", "B · Lanes"))
STATES = ("waiting", "done", "working", "quiet")
STATE_LABEL = {"waiting": "asking you", "done": "done", "working": "working", "quiet": "idle"}


def state(agent: Agent) -> str:
    if agent.status == "waiting":
        return "waiting"
    if agent.unseen:
        return "done"
    if agent.status == "busy":
        return "working"
    return "quiet"


def glyph(agent: Agent, frame: int) -> str:
    current = state(agent)
    if current == "working":
        return SPINNER[frame % len(SPINNER)]
    return {"waiting": "?", "done": "✓", "quiet": "·"}[current]


def ago(timestamp: float, now: float) -> str:
    seconds = max(0, int(now - timestamp))
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    if seconds < 86400:
        return f"{seconds // 3600}h"
    return f"{seconds // 86400}d"


def tokens(count: int) -> str:
    return f"{count / 1_000_000:.1f}M" if count >= 1_000_000 else f"{count / 1000:.0f}k"


def where(agent: Agent) -> str:
    return f"{agent.tmux_session} {agent.window_index}.{agent.pane_index}"


def activity(agent: Agent) -> Content:
    act = agent.activity
    if not act.last_tool:
        return Content.from_markup("[$text-muted]no tool calls yet[/]")
    return Content.from_markup("[$text-secondary]$tool[/] $detail", tool=act.last_tool, detail=act.last_tool_detail)


def task_line(agent: Agent) -> Content:
    if agent.ledger and agent.session_name:
        return Content.from_markup(
            "[$text-accent]◆[/] $title [$text-muted]$status[/]", title=agent.ledger.title, status=agent.ledger.status
        )
    if agent.ledger:
        return Content.from_markup(
            "[$text-accent]◆[/] [$text-muted]$status · $project[/]", status=agent.ledger.status, project=agent.project
        )
    if agent.session_name:
        return Content.from_markup("[$text-muted]◇ no ledger task · $project[/]", project=agent.project)
    return Content.from_markup("[$text-muted]◇ no ledger task · unnamed[/]")


def usage(agent: Agent) -> str:
    act = agent.activity
    return f"{tokens(act.context_tokens)} ${act.cost:.2f}" if act.model else ""


class AgentView(Widget):
    """One agent inside a variant. Owns its state classes; subclasses paint the content."""

    def __init__(self, agent: Agent) -> None:
        super().__init__()
        self.agent = agent

    def on_mount(self) -> None:
        self.paint(time.time(), self.app.frame)

    def set_agent(self, agent: Agent, now: float, frame: int, selected: bool, flash: bool) -> None:
        self.agent = agent
        current = state(agent)
        for name in STATES:
            self.set_class(name == current, f"-{name}")
        self.set_class(selected, "-selected")
        self.set_class(agent.focused, "-here")
        self.set_class(flash, "-flash")
        if self.is_mounted:
            self.paint(now, frame)

    def paint(self, now: float, frame: int) -> None:
        raise NotImplementedError

    def tick(self, frame: int) -> None:
        if state(self.agent) == "working":
            self.paint(time.time(), frame)

    def on_click(self) -> None:
        self.app.jump(self.agent)


def sync(container: Widget, agents: list[Agent], make: type[AgentView], app: Sidebar) -> None:
    """Make `container` hold exactly one view per agent, in `agents` order, updated in place."""
    now = time.time()
    views = {child.agent.session_id: child for child in container.children if isinstance(child, AgentView)}
    wanted = {agent.session_id for agent in agents}
    for session_id, view in views.items():
        if session_id not in wanted:
            view.remove()
    for index, agent in enumerate(agents):
        view = views.get(agent.session_id)
        if view is None:
            view = views[agent.session_id] = make(agent)
            container.mount(view)
        view.set_agent(agent, now, app.frame, agent.session_id == app.selected, app.flashing(agent, now))
        if container.children.index(view) != index:
            container.move_child(view, before=index)


# ── Variant A: cards ─────────────────────────────────────────────────────────────


class Card(AgentView):
    def compose(self) -> ComposeResult:
        yield Static(classes="line task")
        yield Static(classes="line act")
        with Horizontal(classes="spark-row"):
            yield Sparkline([], classes="spark")
            yield Static(classes="meta")

    def paint(self, now: float, frame: int) -> None:
        agent = self.agent
        self.border_title = Content.from_markup("[b]$glyph  $name[/b]", glyph=glyph(agent, frame), name=agent.name)
        subtitle = f"{where(agent)} · {ago(agent.updated_at, now)}"
        self.border_subtitle = (
            Content.from_markup("[b $text-accent]◂ here[/]  $sub", sub=subtitle)
            if agent.focused
            else Content.from_markup("$sub", sub=subtitle)
        )
        self.query_one(".task", Static).update(task_line(agent), layout=False)
        self.query_one(".act", Static).update(activity(agent), layout=False)
        spark = agent.spark(now)
        self.set_class(not any(spark), "-flat")
        self.query_one(Sparkline).data = spark
        self.query_one(".meta", Static).update(usage(agent), layout=False)


class Cards(VerticalScroll):
    def show(self, agents: list[Agent], app: Sidebar) -> None:
        sync(self, agents, Card, app)


# ── Variant B: triage lanes ──────────────────────────────────────────────────────


class LaneRow(AgentView):
    def compose(self) -> ComposeResult:
        with Horizontal(classes="top"):
            yield Static(classes="name")
            yield Static(classes="age")
        yield Static(classes="sub")

    def paint(self, now: float, frame: int) -> None:
        agent = self.agent
        self.query_one(".name", Static).update(
            Content.from_markup("$glyph $name", glyph=glyph(agent, frame), name=agent.name), layout=False
        )
        here = "◂ " if agent.focused else ""
        self.query_one(".age", Static).update(f"{here}{ago(agent.updated_at, now)}", layout=False)
        sub = Content.from_markup("[b]$label[/b] · ", label=STATE_LABEL[state(agent)]) + activity(agent)
        self.query_one(".sub", Static).update(sub, layout=False)


LANES = (
    ("need", "NEEDS YOU", lambda agent: agent.needs_you),
    ("work", "WORKING", lambda agent: not agent.needs_you and agent.status == "busy"),
    ("quiet", "QUIET", lambda agent: not agent.needs_you and agent.status != "busy"),
)


class Lanes(Vertical):
    ROW: type[AgentView] = LaneRow

    def compose(self) -> ComposeResult:
        with Horizontal(classes="hero"):
            yield Digits("0", classes="hero-count")
            yield Static(classes="hero-label")
        with VerticalScroll(classes="lanes"):
            for key, _, _ in LANES:
                yield Static(classes=f"lane-head lane-{key} head-{key}")
                yield Vertical(classes=f"lane lane-body-{key}")

    def show(self, agents: list[Agent], app: Sidebar) -> None:
        need = sum(agent.needs_you for agent in agents)
        working = sum(agent.status == "busy" and not agent.needs_you for agent in agents)
        count = self.query_one(".hero-count", Digits)
        count.update(str(need))
        count.set_class(need == 0, "-clear")
        label = (
            Content.from_markup(
                "[b $text-warning]need you[/]\n[$text-muted]$working working · $quiet quiet[/]",
                working=working,
                quiet=len(agents) - need - working,
            )
            if need
            else Content.from_markup(
                "[b $text-success]all clear[/]\n[$text-muted]$working working · $total agents[/]",
                working=working,
                total=len(agents),
            )
        )
        self.query_one(".hero-label", Static).update(label)
        for key, title, belongs in LANES:
            members = [agent for agent in agents if belongs(agent)]
            head = self.query_one(f".head-{key}", Static)
            head.border_title = f"{title} · {len(members)}"
            head.display = bool(members)
            sync(self.query_one(f".lane-body-{key}", Vertical), members, self.ROW, app)


# ── Default: A's cards in B's lanes ───────────────────────────────────────────────────────


class Merged(Lanes):
    ROW = Card


# ── App ──────────────────────────────────────────────────────────────────────────


class Sidebar(App):
    CSS = """
    Screen { background: ansi_default; }
    ContentSwitcher { height: 1fr; }
    #footer { dock: bottom; height: auto; }
    #keys { height: 1; color: $text-muted; content-align: center middle; }
    #pill { height: 1; content-align: center middle; text-style: bold;
            color: $background; background: $secondary; }
    App:blur #keys { display: none; }
    AgentView { height: auto; }
    AgentView:hover { background: $surface; }
    Static { text-wrap: nowrap; text-overflow: ellipsis; }

    /* A: cards */
    Cards { padding: 0 0; scrollbar-size-vertical: 1; }
    Card { border: round $panel; border-title-color: $text; border-subtitle-color: $text-muted;
           padding: 0 1; }
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

    /* B: lanes */
    .hero { height: 3; margin: 1 1 0 1; }
    .hero-count { width: auto; color: $warning; }
    .hero-count.-clear { color: $success; }
    .hero-label { width: 1fr; height: 3; padding-left: 2; content-align: left middle; }
    Merged .lanes { scrollbar-size-vertical: 1; }
    .lane-head { height: 1; margin-top: 1; margin-bottom: 1; border-top: heavy $panel; border-title-align: left;
                 border-title-style: bold; }
    .lane-need { border-top: heavy $warning; border-title-color: $text-warning; }
    .lane-work { border-top: heavy $primary; border-title-color: $text-primary; }
    .lane-quiet { border-title-color: $text-muted; }
    .lane { height: auto; }
    LaneRow { margin: 0 1; padding: 0 1; border-left: outer $panel; }
    LaneRow .top, LaneRow .sub { height: 1; }
    LaneRow .name { width: 1fr; text-style: bold; }
    LaneRow .age { width: auto; color: $text-muted; padding-left: 1; }
    LaneRow .sub { color: $text-muted; }
    LaneRow.-waiting { border-left: outer $warning; }
    LaneRow.-done { border-left: outer $success; }
    LaneRow.-working { border-left: outer $primary; }
    LaneRow.-quiet { border-left: none; padding-left: 2; }
    LaneRow.-quiet .sub { display: none; }
    LaneRow.-quiet .name { text-style: none; color: $text-muted; }
    LaneRow.-flash { background: $warning 20%; }
    App:focus LaneRow.-selected { background: $surface; }

    """

    BINDINGS = [
        Binding("j,down", "move(1)", "next", show=False),
        Binding("k,up", "move(-1)", "previous", show=False),
        Binding("enter", "jump", "jump", show=False),
        Binding("x", "seen", "mark seen", show=False),
        Binding("X", "seen_all", "mark all seen", show=False),
        Binding("v,right", "variant(1)", "next variant", show=False),
        Binding("V,left", "variant(-1)", "previous variant", show=False),
        Binding("q", "quit", "quit", show=False),
    ]

    def __init__(self) -> None:
        super().__init__(ansi_color=True)
        self.store = AgentStore()
        self.lock = threading.Lock()
        self.agents: list[Agent] = []
        self.selected: str | None = None
        self.frame = 0
        self.variant = 0
        self.previous_states: dict[str, str] = {}
        self.flash_until: dict[str, float] = {}

    def compose(self) -> ComposeResult:
        with ContentSwitcher(initial=VARIANTS[0][0]):
            yield Cards(id="cards")
            yield Lanes(id="lanes")
            yield Merged(id="merged")
        with Vertical(id="footer"):
            yield Static("j/k move · ⏎ jump · x seen · q quit", id="keys")
            yield Static(id="pill")

    def on_mount(self) -> None:
        # Solid muted text: an alpha color blends against the theme background, not the translucent terminal.
        base = BUILTIN_THEMES["catppuccin-mocha"]
        self.register_theme(
            dataclasses.replace(base, name="pi-mocha", variables={**base.variables, "text-muted": "#7f849c"})
        )
        self.theme = "pi-mocha"
        self.paint_pill()
        self.poll()
        self.set_interval(POLL_SECONDS, self.poll)
        self.set_interval(TICK_SECONDS, self.tick)

    @property
    def current(self) -> Cards | Lanes:
        return self.query_one(f"#{VARIANTS[self.variant][0]}")  # type: ignore[return-value]

    def flashing(self, agent: Agent, now: float) -> bool:
        return now < self.flash_until.get(agent.session_id, 0) and (self.frame // 3) % 2 == 0

    @work(thread=True)
    def poll(self) -> None:
        if not self.lock.acquire(blocking=False):
            return
        try:
            agents = self.store.poll()
        finally:
            self.lock.release()
        self.call_from_thread(self.apply, agents)

    def apply(self, agents: list[Agent]) -> None:
        now = time.time()
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
        self.current.show(agents, self)

    def tick(self) -> None:
        self.frame += 1
        now = time.time()
        flashing = any(now < until + TICK_SECONDS * 3 for until in self.flash_until.values())
        if flashing and self.frame % 3 == 0:
            self.current.show(self.agents, self)
            return
        for view in self.current.query(AgentView):
            view.tick(self.frame)

    def paint_pill(self) -> None:
        self.query_one("#pill", Static).update(
            Content.from_markup(
                "[@click=app.variant(2)] ◂ [/] PROTOTYPE  $label [@click=app.variant(1)] ▸ [/]",
                label=VARIANTS[self.variant][1],
            )
        )

    def action_variant(self, step: int) -> None:
        self.variant = (self.variant + step) % len(VARIANTS)
        self.query_one(ContentSwitcher).current = VARIANTS[self.variant][0]
        self.paint_pill()
        self.current.show(self.agents, self)

    def action_move(self, step: int) -> None:
        ids = [agent.session_id for agent in self.agents]
        if not ids:
            return
        index = ids.index(self.selected) if self.selected in ids else 0
        self.selected = ids[(index + step) % len(ids)]
        self.current.show(self.agents, self)
        for view in self.current.query(AgentView):
            if view.agent.session_id == self.selected:
                view.scroll_visible()

    def selected_agent(self) -> Agent | None:
        return next((agent for agent in self.agents if agent.session_id == self.selected), None)

    def action_jump(self) -> None:
        agent = self.selected_agent()
        if agent:
            self.jump(agent)

    def action_seen(self) -> None:
        agent = self.selected_agent()
        if agent is None:
            return
        with self.lock:
            self.store.mark_seen(agent.session_id)
        # Inbox behaviour: the cursor stays in place and lands on the next agent, not on the one that sank.
        ids = [each.session_id for each in self.agents]
        index = ids.index(agent.session_id)
        rest = ids[index + 1 :] or ids[:index]
        self.selected = rest[0] if rest else agent.session_id
        self.poll()

    def action_seen_all(self) -> None:
        with self.lock:
            for agent in self.agents:
                self.store.mark_seen(agent.session_id)
        self.poll()

    def jump(self, agent: Agent) -> None:
        with self.lock:
            self.store.mark_seen(agent.session_id)
        tmux("switch-client", "-t", agent.pane_id)
        tmux("select-window", "-t", agent.pane_id)
        tmux("select-pane", "-t", agent.pane_id)
        self.poll()


if __name__ == "__main__":
    Sidebar().run()
