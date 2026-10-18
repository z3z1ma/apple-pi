"""The listing a supervising agent reads: only sessions that still run, with whom each reports to."""

import agents
from conftest import dead_pid, record


def test_listing_shows_running_sessions_with_their_supervisor_and_drops_dead_ones(env):
    fake, state, _, _ = env
    fake.add_pane("%1")
    fake.add_pane("%2")
    record(state, "worker", "%1", "busy", 100, name="JEM review", cwd="/repo", reports_to="coordinator-work")
    record(state, "crashed", "%2", "idle", 90, pid=dead_pid(), reports_to="coordinator-work")

    assert agents.listing(agents.live()) == [
        {
            "id": "worker",
            "name": "JEM review",
            "status": "busy",
            "cwd": "/repo",
            "reportsTo": "coordinator-work",
            "paneId": "%1",
            "tmuxSession": "work",
            "updatedAt": 100,
        }
    ]
