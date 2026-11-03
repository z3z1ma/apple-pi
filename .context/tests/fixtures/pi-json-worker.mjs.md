## file

A JSON task starts one child tool, waits for the gate response, and reports failure when the body starts with `error:`. `holdTerm` ignores SIGTERM so the worker can emit late events after cancellation.
Why: peer and intern tests need a controlled child that distinguishes a cancelled-but-still-running worker from an immediate exit.
