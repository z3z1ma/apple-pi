"""The sidebar's layout rewrite: proportional, reversible, and faithful to tmux's layout format."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import layout  # noqa: E402

# Captured from tmux 3.5a: a left pane, a stacked pair on the right, and the sidebar (pane 4) as the right column.
WITH_SIDEBAR = "6552,160x45,0,0{30x45,0,0,0,86x45,31,0[86x22,31,0,1,86x22,31,23,2],42x45,118,0,4}"


def widths(text: str) -> list[int]:
    return [child.width for child in layout.parse(text).children]


def test_dump_reproduces_tmux_layout_strings_with_their_checksum():
    assert layout.dump(layout.parse(WITH_SIDEBAR)) == WITH_SIDEBAR


def test_add_then_remove_returns_the_original_layout_exactly_over_many_visits():
    original = layout.dump(layout.parse("0000,160x45,0,0{80x45,0,0,0,79x45,81,0,1}"))
    current = original
    for _ in range(10):
        current = layout.remove(layout.add(current, "9", 42), "9")
    assert current == original


def test_add_shrinks_every_pane_in_proportion_and_puts_the_sidebar_on_the_right():
    added = layout.parse(layout.add("0000,160x45,0,0{80x45,0,0,0,79x45,81,0,1}", "9", 42))
    assert [(c.width, c.x, c.pane) for c in added.children] == [(58, 0, "0"), (58, 59, "1"), (42, 118, "9")]


def test_a_resize_made_while_the_sidebar_is_present_survives_its_departure_in_proportion():
    removed = layout.remove(WITH_SIDEBAR, "4")
    assert widths(removed) == [41, 118]
    assert layout.add(removed, "4", 42) == WITH_SIDEBAR


def test_stacked_panes_take_the_new_width_and_a_lone_pane_becomes_the_root_again():
    added = layout.add("0000,160x45,0,0[160x22,0,0,0,160x22,0,23,1]", "9", 42)
    assert added.endswith("160x45,0,0{117x45,0,0[117x22,0,0,0,117x22,0,23,1],42x45,118,0,9}")
    assert layout.remove(layout.add("0000,160x45,0,0,0", "9", 42), "9").endswith(",160x45,0,0,0")


def test_remove_refuses_a_layout_where_the_pane_is_not_the_right_column():
    with pytest.raises(ValueError):
        layout.remove(WITH_SIDEBAR, "1")


def test_add_refuses_a_window_too_narrow_for_its_panes():
    with pytest.raises(ValueError):
        layout.add("0000,44x45,0,0{21x45,0,0,0,22x45,22,0,1}", "9", 42)
