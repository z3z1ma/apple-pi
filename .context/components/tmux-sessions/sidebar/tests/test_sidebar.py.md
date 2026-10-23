## symbol:card_text

Compare visible border-title text through `Content.from_markup(str(card.border_title)).plain`.
Why: Textual retains markup in `border_title` during headless tests; comparing its raw string can fail on style tags even when the title displays correctly. Keep styling assertions separate from visible-text assertions.
Coupled: components/tmux-sessions/sidebar/sidebar.py, components/tmux-sessions/sidebar/presentation.py
Verify: components/tmux-sessions/sidebar/tests/test_sidebar.py
