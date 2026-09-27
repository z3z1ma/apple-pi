# 05: Saved Python programs become typed tools

**What to build:** A saved project program is a Python file in the project programs directory. Its leading docstring gives a one-line description and `@param` tags that declare typed, optional, defaulted parameters. Each file appears as a `program_<name>` tool with a synthesized parameter schema, and its arguments reach the program as `inputs`. The current rules stay: sync only at cache-safe boundaries, project trust required, re-read from disk on each call, name and path confinement, and reject a malformed description. JavaScript program files are no longer discovered. The saved-programs documentation and prompt guidance describe the Python format.

**Blocked by:** 01: Python programs run on Monty with the core tools.

**Status:** done

- [x] A trusted project with a Python program that declares a `@param` exposes `program_<name>` with that typed parameter at session start, and calling it returns the program result that uses the argument.
- [x] A `.js` file in the programs directory is not listed as a tool.
- [x] An untrusted project cannot run a saved program.
- [x] Editing a program in the middle of a turn changes its behavior on the next call but not the registered tool schema, until the next cache-safe boundary.
