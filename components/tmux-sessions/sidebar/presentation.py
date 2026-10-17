"""How an agent looks, shared by the sidebar and the dashboard: state, glyphs, durations, and the theme."""

from __future__ import annotations

import dataclasses
from pathlib import Path

from agents import Agent
from textual.app import App
from textual.content import Content
from textual.theme import BUILTIN_THEMES
from textual.widgets import Static

SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
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


def count_of(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def tokens(count: int) -> str:
    return f"{count / 1_000_000:.1f}M" if count >= 1_000_000 else f"{count / 1000:.0f}k"


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


def activity(agent: Agent) -> Content:
    act = agent.activity
    if not act.last_tool:
        return Content.from_markup("[$text-muted]no tool calls yet[/]")
    return Content.from_markup("[$text-secondary]$tool[/] $detail", tool=act.last_tool, detail=act.last_tool_detail)


def details(agent: Agent, now: float) -> Content:
    """Everything known about one agent, untruncated, for the dashboard's detail panel."""
    act = agent.activity
    lines = [
        Content.from_markup("[b]$name[/b]", name=agent.name),
        task_line(agent),
        Content.from_markup("[$text-secondary]$tool[/] $detail", tool=act.last_tool, detail=act.last_tool_detail)
        if act.last_tool
        else Content.from_markup("[$text-muted]no tool calls yet[/]"),
        Content.from_markup(
            "[$text-muted]$model · $context context · $$$cost[/]",
            model=act.model or "no model yet",
            context=tokens(act.context_tokens),
            cost=f"{act.cost:.2f}",
        ),
        Content.from_markup(
            "[$text-muted]$where · $state for $age · $cwd[/]",
            where=f"{agent.tmux_session}:{agent.window_index}.{agent.pane_index}",
            state=STATE_LABEL[state(agent)],
            age=ago(agent.updated_at, now),
            cwd=agent.cwd.replace(str(Path.home()), "~"),
        ),
    ]
    return Content("\n").join(lines)


def show(static: Static, content: Content | str) -> None:
    """Update a Static only when its content changed; an always-on view would otherwise repaint every poll."""
    if getattr(static, "shown", None) != content:
        static.shown = content
        static.update(content, layout=False)


def use_theme(app: App) -> None:
    """Catppuccin Mocha with a solid muted text colour.

    The built-in muted colour has alpha, which blends against the theme background rather than the real
    terminal behind an `ansi_default` screen, so muted text would render at full brightness.
    """
    base = BUILTIN_THEMES["catppuccin-mocha"]
    app.register_theme(
        dataclasses.replace(base, name="pi-mocha", variables={**base.variables, "text-muted": "#7f849c"})
    )
    app.theme = "pi-mocha"
