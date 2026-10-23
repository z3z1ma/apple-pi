# Interns

`explore(question)` reads the local repository or filesystem. `research(question, material?)` reads external sources, documentation, APIs, or libraries; material can contain URLs, excerpts, or background. These are cheap, one-shot interns, not people in the organization.

Use an intern when its reading would fill your context with more than the answer is worth. Give it one specific question, the scope, and the evidence you need. Read a small known path yourself. Give lasting engineering work to a [peer](organization.md).

An intern is fast and keeps reading out of your context, but its answer is a lossy summary of only what it chose to report. It can miss, misread, or state a belief as fact. Verify findings before acting, and read the source yourself when the detail decides. Its report should cite paths and lines or source URLs and versions, and separate what it checked from what it believes.

Each call starts one headless Pi process on the user-global `quick` [model profile](setup.md), with a fixed prompt and the reading built-ins, including the shell but excluding `edit` and `write`. Read-only behavior is also an instruction: shell commands can change files, so this is not a security sandbox. The intern receives its question and supplied material, not the caller's conversation. Project trust follows the caller.

Independent calls in one assistant message run in parallel. The shared Active work display shows the current tool and argument. Esc cancels the worker; session shutdown or navigation cancels outstanding calls. Pi's SIGTERM handler cleans up its detached tool processes before exiting.

The answer returns directly from the tool. There is no resume, steering, background handle, conversation viewer, or saved intern transcript. Bound material is removed after the process exits, whether it completed, failed, or was cancelled. A failed or truncated report is an error, not a verified finding.

Implementation: `components/interns/` owns the tools, fixed prompts, and one-shot process runner (`src/runner.ts`). There is no worker manager and no catalog of user-defined helpers. The runner loads an explicit extension list with discovery disabled and `--no-session`. The interns do not load their own extension, so they cannot delegate to more interns.
