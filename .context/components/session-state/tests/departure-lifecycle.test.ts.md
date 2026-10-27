## file

These cases use the existing scripted-model SDK harness in an isolated child process with only the native workplace extension. A retained SessionManager, actual bridge, daemon, filesystem and OS exit participate; the choice and prose remain scripted. The parent calls native let_go and receives its accepted reference before releasing the held final turn. Its production command client disconnects at acceptance, so later completion also exercises daemon ownership after caller disconnection.
Why: an in-process SDK victim shares the test/manager PID and cannot honestly prove process death or authorize signalling that host. A prototype guard or socket reply alone is not full native-session proof.

The child can end its SDK session while keeping the OS host alive, or replace it with another SDK session in the same process. These are separate safety controls. Rejected flag-free resumes are observed through their actual close and owned-file cleanup, without new incarnations; a later attempt leaves the earlier applied receipt truthful. Legacy former controls retain their row/file/history and acquire no cleanup ownership.

Final synthetic handoff usage is a positive increment. Compare recorded compute before/after and its cost event before the departure marker, rather than guessing a cumulative transcript total or inventing an extra charge from the reply. Work/mail setup asserts applied receipts before relying on the produced assignment/outcome; a resolved command promise can carry failure.
Why: initial retained costs and observation conventions are separate from whether this final turn's observed spend survives removal.

Production and fixture helpers both export `sendCommand` with different call shapes. Use the production import's positional `(sessionId, command, options)` contract and typecheck new harness code before execution.
Why: a miscalled producer can resolve with a failed receipt; a later missing-assignment assertion then reports the setup error as a retention failure.

Expected sidecar files are spelled independently using the existing agent-directory `.ndjson` layout and rotation. Read the producer's complete path composition before changing those expectations; using a guessed suffix/root exercises unrelated files, not cleanup.

The fake pi executable used for the asleep control runs this same SDK host in its own process and opens the recorded transcript. The first model observation is the correlated handoff, not a positional startup prompt. This is scripted SDK/process integration, not native CLI parsing, installed-package behavior, paid-model judgment or a general OS sandbox.

Coupled: components/session-state/src/client.ts, components/session-state/tests/helpers.ts, components/session-state/tests/fixtures/departure-person.ts, tests/helpers/faux-session.ts, components/session-state/src/runtime.ts, components/session-state/src/departures.ts, components/shared/src/sidecar-usage-path.ts
Verify: components/session-state/tests/departure-lifecycle.test.ts
