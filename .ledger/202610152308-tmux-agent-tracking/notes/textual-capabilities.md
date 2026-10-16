# Textual 8.2.8 capabilities brief for an agent-monitoring TUI

**Version basis:** Textual **8.2.8**, the version declared in the [`v8.2.8` source `pyproject.toml`](https://github.com/Textualize/textual/blob/v8.2.8/pyproject.toml). The project classifiers include Python 3.9–3.14; use the version’s `requires-python` metadata when pinning a supported interpreter. This brief uses the versioned source and official Textual and Rich documentation, not older blog APIs.

## 1. App structure

A typical app composes widgets declaratively. `compose()` is called when the screen is mounted; for later additions, use `mount()`. `recompose()` removes and rebuilds the widget’s composed children, so it is useful for wholesale structural changes, but not for ordinary frequent value updates.

```python
from textual.app import App, ComposeResult
from textual.widgets import Static

class Monitor(App):
    CSS_PATH = "monitor.tcss"
    BINDINGS = [
        ("q", "quit", "Quit"),
        ("d", "toggle_details", "Details"),
    ]

    def compose(self) -> ComposeResult:
        yield Static("Agents", id="agents")

    def action_toggle_details(self) -> None:
        self.query_one("#agents", Static).update("Details toggled")

    def on_mount(self) -> None:
        self.set_interval(1, self.refresh_agents)

    def refresh_agents(self) -> None:
        self.query_one("#agents", Static).update("Live agent state")
```

`BINDINGS` entries can use `Binding` objects for options such as `show` and `priority`; priority bindings are checked ahead of focused-widget bindings. Actions are methods named `action_<name>`. `@on(...)` handlers route messages/events by type and optional selectors:

```python
from textual import on
from textual.widgets import Button

@on(Button.Pressed, "#refresh")
def refresh_clicked(self) -> None:
    self.refresh_agents()
```

Widgets can post custom `Message` objects to their ancestors; this is the standard way to report a child interaction without coupling the child to a particular parent implementation.

Screens are full-screen widget trees. Use `push_screen` / `pop_screen` for modal or navigable screens. **Modes** associate screen states with bindings; they suit switching between app-level views (e.g. sidebar and dashboard) without treating each view as a transient modal.

`CSS_PATH` points to an external TCSS file. `CSS` embeds CSS in the app class; `App.run(inline=True)` selects inline terminal rendering, not inline CSS. It also accepts `size=(width, height)` for fixed-size/headless use. Sources: [App guide](https://textual.textualize.io/guide/app/), [screens](https://textual.textualize.io/guide/screens/), [actions](https://textual.textualize.io/guide/actions/), [events](https://textual.textualize.io/guide/events/), [`App.run` in 8.2.8 source](https://github.com/Textualize/textual/blob/v8.2.8/src/textual/app.py#L2308-L2327).

## 2. Reactivity and efficient updates

`reactive` and `var` descriptors provide reactive state. Assigning a changed value triggers a watcher; `watch_<name>` is the conventional watcher method. `var` is the simpler variable form. `recompose=True` requests recomposition when that reactive changes; use it when the child structure depends on the value, not for a rapidly changing status number.

`data_bind` connects a widget’s reactive attribute to another reactive source. Validation can be supplied on a reactive descriptor; `set_reactive` is the imperative API for setting a reactive value while controlling whether validation/watch behavior is applied. Check the API doc for the exact descriptor options and binding direction before relying on complex two-way binding.

For a live monitor, update the smallest possible widget. `Static.update(content, layout=True)` replaces its content; set `layout=False` when the new content cannot affect geometry. Avoid rebuilding the whole app for each tick. `refresh()` schedules a repaint; layout invalidation is needed only when geometry changes. There is no public `batch_update` method on `Static` in the 8.2.8 source; **UNVERIFIED** whether a similarly named batching API exists elsewhere in the framework. Prefer fewer, coalesced updates and `layout=False` where applicable. Sources: [reactivity guide](https://textual.textualize.io/guide/reactivity/), [data binding](https://textual.textualize.io/guide/data_binding/), [`Static.update` source](https://github.com/Textualize/textual/blob/v8.2.8/src/textual/widgets/_static.py).

## 3. Timers, workers, subprocesses, file watching

`set_interval(seconds, callback)` is appropriate for polling or a clock; `set_timer` schedules one call. Avoid a tight interval: subprocess latency, redraws, and terminal output all consume time.

`@work` runs work outside the UI event loop. Async workers suit async I/O; `thread=True` is for blocking synchronous calls. `exclusive=True` cancels/replaces previous workers in the same worker group, which is useful when a refresh should supersede an in-flight refresh. Retain/cancel workers when their lifecycle is tied to a widget or screen. Never block the event loop with `subprocess.run` or synchronous filesystem/network calls.

```python
import asyncio
from textual import work

@work(exclusive=True, group="tmux")
async def poll(self) -> None:
    proc = await asyncio.create_subprocess_exec(
        "tmux", "list-panes", "-a", "-F", "#{pane_id} #{pane_current_command}",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    self.post_message(PanesReceived(out.decode(), err.decode()))
```

For a synchronous API, move it to a thread worker rather than invoking it on the UI thread. Textual itself does not make the external tmux process asynchronous; the example uses Python’s asyncio subprocess API. Textual provides no general built-in filesystem watcher guarantee in these cited APIs; use a polling interval or a separate file-watch library and pass results back through a worker/message. Sources: [workers guide](https://textual.textualize.io/guide/workers/), [timer API](https://textual.textualize.io/api/app/), [Python asyncio subprocess docs](https://docs.python.org/3/library/asyncio-subprocess.html).

## 4. Layout

Textual supports `Vertical`, `Horizontal`, and `Grid` containers, plus CSS `dock` for edge-attached widgets and `layers` for stacking. `fr` divides remaining space, `auto` fits content, percentages use the available dimension, and `height: auto` fits a widget’s content. `min-width` / `max-width` and their height counterparts constrain sizing.

`VerticalScroll` and `HorizontalScroll` provide scrolling containers; overflow properties control whether excess content is clipped or scrollable. For the 36–44-column pane, allocate width explicitly and avoid multi-column grids that assume desktop width. Use `auto`/`fr` carefully: long agent names or ANSI previews can trigger wrapping and change layout. Define compact states using breakpoints or conditional composition where necessary. Sources: [layout guide](https://textual.textualize.io/guide/layout/), [CSS layout](https://textual.textualize.io/styles/layout/), [scrolling](https://textual.textualize.io/guide/scrolling/).

## 5. TCSS visual toolkit

The [CSS reference](https://textual.textualize.io/css/) and [styles reference](https://textual.textualize.io/styles/) are the authoritative property lists. In 8.2.x, the expressive toolkit includes:

- **Edges and framing:** `border` (including named border types), `border-title`, `border-subtitle`, their alignment/style controls, `outline`, `keyline`, `hatch`, `padding`, and `margin`.
- **Color and overlays:** `tint`, `background-tint`, `text-opacity`, `opacity`, `text-style`, and `text-wrap` / `text-overflow`. `link-*` controls link presentation; `scrollbar-*` styles scrollbars; `pointer` controls pointer behavior/cursor presentation.
- **Interaction selectors:** `:hover`, `:focus`, `:focus-within`, `:disabled`; app theme selectors `:dark` / `:light`; structural `:first-child`, `:last-child`, `:odd`, `:even`; and `:inline` / `:ansi` for relevant terminal/display states.
- **Reuse and color tokens:** nested selectors and CSS variables; built-in theme variables include `$primary`, `$accent`, `$warning`, `$error`, `$success`, `$surface`, `$panel`, `$boost`, `$foreground-muted`, and generated lighten/darken/muted variants.

For a premium compact sidebar, use a thin border, a restrained accent for selected/active state, muted secondary labels, and a high-contrast alert color; use `text-overflow` rather than letting unbounded names widen the pane. Exact property syntax and supported values can change across releases: consult the linked 8.2 documentation rather than transplanting old CSS examples.

## 6. Animation and spinners

`widget.animate(attribute, value, duration=..., easing=...)` animates a widget style/reactive attribute; `widget.styles.animate(...)` animates styles directly. Styles that can be animated include offset, opacity, and color/background properties. Textual provides named easing functions; use the [animation API reference](https://textual.textualize.io/api/animator/) for the complete 8.2.x list and signatures. `App.animation_level` controls the app’s animation policy; honor it for reduced-animation behavior.

For attention, animate a short opacity/background transition on a changed agent row and stop/restart it on meaningful state changes; avoid perpetual high-frequency flashing. `LoadingIndicator` is the ready-made spinner. A timer-driven Braille spinner is also possible, but verify glyph cell width in the actual terminal/font. Sources: [animations guide](https://textual.textualize.io/guide/animation/), [widgets gallery](https://textual.textualize.io/widgets/), [`App.animation_level` source](https://github.com/Textualize/textual/blob/v8.2.8/src/textual/app.py).

## 7. Content, markup, and ANSI preview

Textual 8.x has an immutable `Content` class: it is Textual’s own styled-text container, described in source as equivalent to Rich `Text` with Textual features. `Content.from_markup(...)` accepts Textual markup and variables:

```python
from textual.content import Content
status = Content.from_markup("[$accent]●[/] [b]$agent[/b]", agent="planner")
```

Markup supports styles such as `[b]...[/b]`, color variables such as `[$accent]...[/]`, and action/link syntax such as `[@click=app.action]...[/]`. Rich `Text.from_ansi` parses ANSI escape sequences into styled text; a `Static` can render Rich renderables such as Rich `Text`.

```python
from rich.text import Text
from textual.widgets import Static

preview = Text.from_ansi(captured_pane_text)
self.query_one("#preview", Static).update(preview)
```

For `tmux capture-pane -e -p`, preserve escape sequences through subprocess decoding, but do not assume every escape/control sequence in arbitrary pane output is safe or rendered identically. Test actual color output and clipping/wrapping. **Version warning:** older examples frequently assume mutable Rich `Text` as Textual’s primary content object; `Content` is immutable in 8.x. Sources: [Content API](https://textual.textualize.io/api/content/), [markup guide](https://textual.textualize.io/guide/content/), [Rich ANSI docs](https://rich.readthedocs.io/en/stable/reference/text.html#rich.text.Text.from_ansi), [`Content` 8.2.8 source](https://github.com/Textualize/textual/blob/v8.2.8/src/textual/content.py).

## 8. Useful widgets for monitoring

The [widget gallery](https://textual.textualize.io/widgets/) documents the widgets; choose based on volume and update rate.

| Widget | Monitoring use; notable options / pitfalls |
|---|---|
| `Static` | Compact custom status rows, preview, labels; flexible markup/renderables. Best default for frequently refreshed content. |
| `Label` | Short labels; less flexible than composing a custom `Static` row. |
| `ListView` / `ListItem` | Selectable agent list and keyboard navigation; item-based structure, selection/focus semantics. |
| `OptionList` | Selectable options/commands; supports highlighted options; not a dense live table. |
| `DataTable` | Structured dashboard metrics; columns/rows and cursor; can be too wide for 36–44 columns. |
| `Tree` | Agent hierarchy / parent-child tasks; expandable nodes; verbose hierarchy can consume sidebar height. |
| `Collapsible` | Hide details/log context; title and collapsed state; useful when height is constrained. |
| `TabbedContent` / `ContentSwitcher` | Swap panes such as Agents / Logs / Preview; tabs cost scarce width. |
| `Sparkline` | Tiny metric trend; feed a bounded sequence of samples, not raw unbounded history. |
| `Digits` | High-visibility counts/timers; decorative digits consume width. |
| `ProgressBar` | Task completion; determinate or indeterminate; avoid implying progress when only activity is known. |
| `LoadingIndicator` | Built-in activity indication; prefer over custom animation unless a distinctive state is required. |
| `Rule` | Visual separators; consumes a row in a narrow pane. |
| `Tooltip` | Hover detail without permanent width/height cost; mouse availability matters. |
| `Toast` / `App.notify` | Transient alerts; `notify(message, title, severity, timeout, markup)`; do not use for durable agent state. |
| `Header` / `Footer` | Standard chrome and key hints; can consume valuable vertical rows. |
| `Link` | Clickable URL/text; terminal hyperlink support varies. |
| `Placeholder` | Layout scaffolding during development; replace in production. |
| `Log` / `RichLog` | Append-only events; scrolling and retention matter; cap volume. |
| `Markdown` | Documentation/help panels; heavier and less suitable for rapid updates. |
| `Pretty` | Debug/introspection of Python values; useful during development, not an optimized live display. |

## 9. Themes and terminal blending

The 8.2.8 source’s built-in theme registry includes **Catppuccin Latte, Frappé, Macchiato, and Mocha**. Other built-ins include Textual dark/light, Nord, Gruvbox, Dracula, Tokyo Night, Monokai, Flexoki, Solarized light/dark, Rose Pine variants, Atom One variants, and ANSI dark/light. See [`BUILTIN_THEMES` at v8.2.8](https://github.com/Textualize/textual/blob/v8.2.8/src/textual/theme.py).

`Theme` fields include `name`, `primary`, `secondary`, `warning`, `error`, `success`, `accent`, `foreground`, `background`, `surface`, `panel`, `boost`, `dark`, `luminosity_spread`, `text_alpha`, `variables`, and `ansi`. Register with `app.register_theme(theme)` and set `app.theme = "name"`.

To blend with terminal colors, `ansi_color` is the CSS color function for terminal palette colors; `background: ansi_default` uses the terminal’s default background, and `:ansi` targets the ANSI theme/state. Avoid assuming transparent-background support is universal: terminal emulator, multiplexing, and color rendering affect the result. Verify in Ghostty inside tmux, especially when using alpha/transparency. Sources: [themes guide](https://textual.textualize.io/guide/themes/), [CSS colors](https://textual.textualize.io/css/color/), [8.2.8 theme source](https://github.com/Textualize/textual/blob/v8.2.8/src/textual/theme.py).

## 10. Mouse, focus, and tmux

Textual supports click/hover events and focusable widgets; use `can_focus` to control whether a widget participates in keyboard focus. Focus is navigable by keyboard, typically Tab/Shift-Tab, with widget-specific arrow-key behavior. `App.app_focus` represents whether the app considers itself terminal-focused; the 8.2.8 source handles `AppFocus` and blur events.

tmux mouse support generally requires `set -g mouse on` for mouse events to be reported/forwarded through tmux. Textual’s `App.run(mouse=True)` enables its mouse handling, but cannot override tmux’s configuration. **Not verified:** whether a specific terminal’s focus-reporting sequence is enabled by default through a given Ghostty/tmux configuration; test `FocusIn` / `FocusOut` behavior in the target setup.

An unfocused pane still runs its event loop and can update/render to its terminal; it does not receive ordinary keyboard/mouse input while the user is interacting elsewhere. Focus reporting depends on terminal/multiplexer support. Sources: [Textual focus guide](https://textual.textualize.io/guide/widgets/#focus), [events API](https://textual.textualize.io/api/events/), [`app_focus` and event handlers in 8.2.8](https://github.com/Textualize/textual/blob/v8.2.8/src/textual/app.py).

## 11. Command palette

Textual’s command palette can expose built-in/system commands and app-specific commands through custom `Provider` implementations. Providers discover hits and return descriptions/actions; use it for “focus agent”, “filter failed”, or “switch dashboard” commands. Disable it by removing/disabling its binding or customizing the app bindings as appropriate. Sources: [command palette guide](https://textual.textualize.io/guide/command_palette/), [command API](https://textual.textualize.io/api/command/).

## 12. Terminal and tmux pitfalls

- Ensure a true-color-capable path; `TERM=tmux-256color` is a conventional tmux terminfo value, but verify the installed terminfo entry and Ghostty’s negotiated capabilities.
- `COLORTERM` and `TEXTUAL_COLOR_SYSTEM` can influence color detection/override; test in the actual environment rather than hard-coding based on a local shell.
- Unicode display width is terminal/font-dependent. Braille, emoji, and Nerd Font glyphs may render as unexpected widths or missing glyphs; test row alignment and provide ASCII fallbacks.
- Flicker can stem from excessive full-screen updates, layout churn, or terminal behavior. Update only changed widgets and avoid unnecessary recomposition.
- Startup time depends on interpreter/imports and dependencies; `uv run --script` may need environment/dependency resolution on first invocation. Benchmark cold and warm startup separately.
- tmux `escape-time` can affect escape-sequence responsiveness; do not change it without checking other keybindings/apps.
  
Sources: [Textual color system](https://textual.textualize.io/guide/), [Textual FAQ](https://textual.textualize.io/guide/faq/), [tmux manual](https://man.openbsd.org/tmux.1). Exact impact of Ghostty/tmux/macOS settings on this app is configuration-specific.

## 13. Testing and visual verification

`App.run_test()` returns a test pilot; use `Pilot.press`, `click`, `pause`, and `resize` to exercise interactions and allow timers/workers to settle. `app.save_screenshot()` exports an SVG screenshot. `pytest-textual-snapshot` supports snapshot comparison. `textual run --dev` enables the development console; `textual keys` is a useful keyboard inspection tool. Use `run_test(size=(width, height))` or `App.run(headless=True, size=(...))` for reproducible fixed-size runs, then visually verify in tmux/Ghostty for terminal-specific behavior. Sources: [testing guide](https://textual.textualize.io/guide/testing/), [Pilot API](https://textual.textualize.io/api/pilot/), [CLI reference](https://textual.textualize.io/guide/cli/).

## 14. Packaging with PEP 723 / uv

A standalone script can declare inline dependencies:

```python
# /// script
# requires-python = ">=3.9"
# dependencies = ["textual>=8.2,<9"]
# ///
```

Then run `uv run --script monitor.py`. Pinning `<9` prevents an unreviewed major-version jump; use an exact tested pin or lock strategy for reproducible deployments. Textual 8.2.8’s source classifiers include Python 3.9–3.14; the project’s package metadata is authoritative for the precise lower bound. Cold start may include uv environment creation/dependency resolution; measure it separately from warm start. Sources: [uv scripts / PEP 723](https://docs.astral.sh/uv/guides/scripts/), [Textual 8.2.8 project metadata](https://github.com/Textualize/textual/blob/v8.2.8/pyproject.toml).

## 15. Expressive techniques to borrow

These are useful patterns to inspect in Textual’s own 8.x examples/demo and documented apps; adapt rather than copy APIs from unpinned branches.

1. **Demo app (`python -m textual`)** — inspect the demo’s navigation and widget showcase for a polished full-app structure and discoverable controls. [Textual repository](https://github.com/Textualize/textual).
2. **Command palette provider** — surface agent filters and actions as searchable commands rather than adding permanent controls. [Command palette guide](https://textual.textualize.io/guide/command_palette/).
3. **Rich `Content` status lines** — combine a compact state glyph, bold agent name, muted metadata, and themed severity in a single row. [Content guide](https://textual.textualize.io/guide/content/).
4. **`Sparkline` for trend-at-a-glance** — encode recent activity or latency without adding a chart panel. [Sparkline widget](https://textual.textualize.io/widgets/sparkline/).
5. **Collapsible details** — keep the default agent list dense and reveal logs/metadata on demand. [Collapsible widget](https://textual.textualize.io/widgets/collapsible/).
6. **`RichLog` for event stream** — append discrete agent lifecycle events, with bounded retention and explicit follow/scroll behavior. [RichLog widget](https://textual.textualize.io/widgets/rich_log/).
7. **Animated state transition** — briefly emphasize a state change, then settle to a stable color instead of continuously pulsing all rows. [Animation guide](https://textual.textualize.io/guide/animation/).
8. **Theme-aware tokens and ANSI blending** — use `$accent` / `$error` / `$foreground-muted` rather than hard-coded colors, and verify terminal background integration in the real pane. [Themes guide](https://textual.textualize.io/guide/themes/).
9. **Snapshot-driven narrow layout** — lock a 40-column test size and maintain snapshots for the sidebar; separately test the expanded dashboard width. [Testing guide](https://textual.textualize.io/guide/testing/).

### Version/API cautions

- Treat 8.2.x `Content` as immutable; older advice centered on mutating `Rich Text` in-place does not transfer directly.
- Use current `Content.from_markup` / widget `update` interfaces and current TCSS reference; do not assume APIs/property names from Textual 0.x or early 1.x examples remain valid.
- The 8.2.8 source confirms `App.run(inline=...)`, `App.animation_level`, `app_focus`, `register_theme`, `Content.from_markup`, and the Macchiato theme. **UNVERIFIED here:** exhaustive release-by-release deprecation mapping from 0.x/1.x to 8.x; consult the [8.x changelog](https://github.com/Textualize/textual/blob/v8.2.8/CHANGELOG.md) for any specific legacy API before migration.