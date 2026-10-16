"""Rewrite a tmux window layout so the sidebar arrives and leaves without distorting the other panes.

tmux shrinks panes unevenly when a full-height pane joins a window and hands all the space back to the
rightmost pane when it leaves. This scales the window's own layout tree proportionally instead:

    layout.py add <window_layout> <pane_number> <width>   the layout with that pane as a full-height right column
    layout.py remove <window_layout> <pane_number>        the layout without that right column, full width again

`select-layout` assigns panes to leaf cells in the window's pane-list order, so the sidebar must be the
window's last pane. Prints nothing when the layout cannot be rewritten; the caller then keeps tmux's own result.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field


@dataclass
class Cell:
    width: int
    height: int
    x: int
    y: int
    kind: str  # "leaf", "{" (side by side), or "[" (stacked)
    pane: str = ""
    children: list[Cell] = field(default_factory=list)


def parse(layout: str) -> Cell:
    """Parse a `#{window_layout}` string: a checksum, then the root cell."""
    body = layout.split(",", 1)[1]
    cell, end = _cell(body, 0)
    if end != len(body):
        raise ValueError(f"trailing layout text: {body[end:]!r}")
    return cell


def _number(text: str, at: int) -> tuple[int, int]:
    end = at
    while end < len(text) and text[end].isdigit():
        end += 1
    if end == at:
        raise ValueError(f"expected a number at {at} in {text!r}")
    return int(text[at:end]), end


def _cell(text: str, at: int) -> tuple[Cell, int]:
    width, at = _number(text, at)
    height, at = _number(text, at + 1)
    x, at = _number(text, at + 1)
    y, at = _number(text, at + 1)
    if at < len(text) and text[at] in "{[":
        kind, close = text[at], "}" if text[at] == "{" else "]"
        children = []
        at += 1
        while True:
            child, at = _cell(text, at)
            children.append(child)
            if text[at] == close:
                return Cell(width, height, x, y, kind, children=children), at + 1
            at += 1
    pane, at = _number(text, at + 1)
    return Cell(width, height, x, y, "leaf", pane=str(pane)), at


def dump(cell: Cell) -> str:
    """The layout string with tmux's checksum, ready for `select-layout`."""
    body = _dump(cell)
    checksum = 0
    for char in body:
        checksum = ((checksum >> 1) | ((checksum & 1) << 15)) + ord(char)
        checksum &= 0xFFFF
    return f"{checksum:04x},{body}"


def _dump(cell: Cell) -> str:
    head = f"{cell.width}x{cell.height},{cell.x},{cell.y}"
    if cell.kind == "leaf":
        return f"{head},{cell.pane}"
    close = "}" if cell.kind == "{" else "]"
    return head + cell.kind + ",".join(_dump(child) for child in cell.children) + close


def scale(cell: Cell, width: int, x: int) -> None:
    """Resize `cell` to `width` columns at column `x`, sharing the change across side-by-side children in proportion."""
    old_width, cell.width, cell.x = cell.width, width, x
    if cell.kind == "[":
        for child in cell.children:
            scale(child, width, x)
    elif cell.kind == "{":
        borders = len(cell.children) - 1
        old_room, room = old_width - borders, width - borders
        edge, used = 0, 0
        for child in cell.children:
            edge += child.width
            # Cumulative rounding keeps the widths summing exactly to the new room.
            boundary = round(edge * room / old_room)
            if boundary - used < 1:
                raise ValueError("window too narrow")
            scale(child, boundary - used, x)
            x += boundary - used + 1
            used = boundary


def add(layout: str, pane: str, width: int) -> str:
    window = parse(layout)
    full, height = window.width, window.height
    rest = full - width - 1
    scale(window, rest, 0)
    column = Cell(width, height, rest + 1, 0, "leaf", pane=pane)
    children = window.children if window.kind == "{" else [window]
    return dump(Cell(full, height, 0, 0, "{", children=[*children, column]))


def remove(layout: str, pane: str) -> str:
    window = parse(layout)
    if window.kind != "{" or window.children[-1].kind != "leaf" or window.children[-1].pane != pane:
        raise ValueError("the pane is not the window's right column")
    rest = window.children[:-1]
    if len(rest) == 1:
        remaining = rest[0]
    else:
        remaining = Cell(sum(child.width for child in rest) + len(rest) - 1, window.height, 0, 0, "{", children=rest)
    scale(remaining, window.width, 0)
    return dump(remaining)


if __name__ == "__main__":
    try:
        if sys.argv[1] == "add":
            print(add(sys.argv[2], sys.argv[3], int(sys.argv[4])))
        elif sys.argv[1] == "remove":
            print(remove(sys.argv[2], sys.argv[3]))
    except (IndexError, ValueError):
        pass
