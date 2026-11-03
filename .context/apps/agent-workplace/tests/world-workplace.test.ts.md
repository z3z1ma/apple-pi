## file

These cases use the built world UI over a fixture backend. Backend suites prove the calls reach the runtime; this suite proves where the operator finds them and what the UI sends. Picking a goal up assigns it to nobody; only handing it over assigns it.
Why: a carry action that assigned the goal would skip the explicit give step.
