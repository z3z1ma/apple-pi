## symbol:legacyConfigPath

The pre-rename settings file is read once as a fallback.
Why: upgrading must not silently turn off a toggle the operator already saved under the old path.

## file

Command handlers can run while the agent is streaming. Rapid toggles are serialized, but the first transition is published to memory immediately.
Why: every session that loads fast mode refreshes the shared setting before each provider request. A mid-turn toggle therefore reaches the next continuation, including sessions that were already running when the setting changed.
