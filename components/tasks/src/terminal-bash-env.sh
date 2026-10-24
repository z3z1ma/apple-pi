# BASH_ENV for commands on Bash's pseudo-terminal: color ls, grep, and diff as interactive shells do.
# Only the command's own shell loads it; nested bash scripts get the operator's BASH_ENV back.
if [ -n "${PI_TERMINAL_PREVIOUS_BASH_ENV:-}" ]; then
	export BASH_ENV="$PI_TERMINAL_PREVIOUS_BASH_ENV"
	. "$BASH_ENV"
else
	unset BASH_ENV
fi
unset PI_TERMINAL_PREVIOUS_BASH_ENV
if command ls --color=auto -d / >/dev/null 2>&1; then ls() { command ls --color=auto "$@"; }; fi
if printf x | command grep --color=auto -q x 2>/dev/null; then grep() { command grep --color=auto "$@"; }; fi
if command diff --color=auto /dev/null /dev/null >/dev/null 2>&1; then diff() { command diff --color=auto "$@"; }; fi
