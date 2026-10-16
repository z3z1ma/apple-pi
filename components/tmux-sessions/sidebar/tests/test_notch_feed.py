"""The notch panel's feed: one record per live agent with the fields its page reads."""

import json
import time

import agents
from conftest import SOCKET, record


def test_feed_records_carry_display_state_identity_activity_and_this_tmux_server(env):
    fake, state, sessions, _ = env
    now = int(time.time())
    for pane in ("%1", "%2", "%3", "%4"):
        fake.add_pane(pane, seen_at=str(now))
    fake.add_pane("%5", seen_at=str(now - 60))
    record(state, "asking", "%1", "waiting", now - 30, name="Fix the login bug")
    record(state, "busy", "%2", "busy", now - 20)
    record(state, "seen", "%3", "idle", now - 90)
    record(state, "finished", "%5", "idle", now - 10)
    log = sessions / "cwd" / "2026-01-01T00-00-00_busy.jsonl"
    log.parent.mkdir()
    call = {"type": "toolCall", "name": "bash", "arguments": {"command": "npm test"}}
    entry = {"timestamp": "2026-01-01T00:00:00Z", "message": {"role": "assistant", "content": [call]}}
    log.write_text(json.dumps({"type": "message", **entry}) + "\n")

    feed = {item["id"]: item for item in map(agents.feed_record, agents.AgentStore().poll())}

    assert {key: item["state"] for key, item in feed.items()} == {
        "asking": "waiting",
        "finished": "done",
        "busy": "working",
        "seen": "quiet",
    }
    assert feed["asking"] | {"updatedAt": 0} == {
        "id": "asking",
        "name": "Fix the login bug",
        "project": "project",
        "state": "waiting",
        "tool": "",
        "detail": "",
        "tmuxSession": "work",
        "paneId": "%1",
        "tmuxSocket": SOCKET,
        "updatedAt": 0,
    }
    assert (feed["busy"]["tool"], feed["busy"]["detail"]) == ("bash", "npm test")
    assert json.loads(json.dumps(list(feed.values()))) == list(feed.values())
