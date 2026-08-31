# Home search guard

The home search guard blocks agent searches whose root is exactly the current user's home directory. It prevents an incorrect broad root from turning a narrow lookup into a long, CPU-heavy crawl.

The guard covers:

- Pi `grep`, `find`, and `glob` tool calls when their explicit or implicit root resolves to `$HOME`;
- agent `bash` calls that run `rg`, `ripgrep`, `grep`, `egrep`, `fgrep`, `find`, `fd`, or `fdfind` with `$HOME` as the working or supplied root;
- the same tools in interactive child agents and `pi_exec` workers;
- direct `pi.grep`, `pi.find`, and `pi.bash` calls inside `pi_exec`.

A path below home remains valid. For example, searching `~/code/project` is allowed; searching `~`, `$HOME`, or the resolved home path is blocked with a request to use a narrower root.

The extension intercepts agent tool calls only. It does not intercept shell commands entered directly by the user with Pi's `!` or `!!` syntax.
