## file

Integration adapters use a loopback HTTP server that records every request and a fake `gh` on PATH. The server answers with the first route that answers, otherwise 404. A `gh` rule matches when every listed argument appears in order. The fake is first on PATH and logs each call's arguments and working directory. The last matching rule supplies JSON or text.
Why: a later rule must be able to override an earlier one, and argument order is part of the command contract.
