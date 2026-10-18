"""Shared fakes: tmux answers, a session-state database built by the runtime's own migrations, a fake runtime
socket, and (for the notch feed and listing) the old state, session, and ledger files."""

import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import agents  # noqa: E402
import dashboard  # noqa: E402
import model  # noqa: E402
import sidebar  # noqa: E402

REPO = Path(__file__).resolve().parents[4]
SOCKET = "/tmp/tmux-test/default"


class FakeTmux:
    """Answers the tmux queries the sidebar makes and records the commands it sends."""

    def __init__(self) -> None:
        self.panes: dict[str, dict[str, str]] = {}
        self.focused: set[str] = set()
        self.commands: list[tuple[str, ...]] = []
        self.screens: dict[str, str] = {}
        self.watched = True

    def add_pane(self, pane_id: str, seen_at: str = "") -> None:
        self.panes[pane_id] = {"session": "work", "window": "1", "index": str(len(self.panes) + 1), "seen": seen_at}

    def __call__(self, *args: str) -> str:
        if args[0] == "display-message" and "server\t#{socket_path}" in args:
            return (
                f"server\t{SOCKET}\n"
                + "".join(f"client\t{pane}\n" for pane in self.focused)
                + "".join(f"pane\t{pane}\t{p['index']}\n" for pane, p in self.panes.items())
            )
        if args[0] == "list-panes":
            panes = "".join(
                f"pane\t{SOCKET}\t{pane}\t/dev/tty{pane[1:]}\t{p['session']}\t{p['window']}\t{p['index']}\t{p['seen']}\n"
                for pane, p in self.panes.items()
            )
            return panes + "".join(f"client\t{pane}\n" for pane in self.focused)
        if args[:3] == ("list-clients", "-F", "#{window_id}"):
            return "@1\n" if self.watched else ""
        if args[0] == "list-clients":
            return "".join(f"{pane}\n" for pane in self.focused)
        if args[0] == "capture-pane":
            return self.screens.get(args[-1], "")
        if args[:2] == ("display-message", "-p") and args[-1] == "#{window_id}":
            return "@1\n"
        self.commands.append(args)
        if args[:2] == ("set", "-p"):
            self.panes[args[3]]["seen"] = args[5]
        return ""


@pytest.fixture
def env(tmp_path, monkeypatch):
    fake = FakeTmux()
    state = tmp_path / "state"
    sessions = tmp_path / "sessions"
    state.mkdir()
    sessions.mkdir()
    monkeypatch.setattr(agents, "tmux", fake)
    monkeypatch.setattr(sidebar, "tmux", fake)
    monkeypatch.setattr(dashboard, "tmux", fake)
    monkeypatch.setattr(agents, "STATE_DIR", state)
    monkeypatch.setattr(agents, "SESSIONS_DIR", sessions)
    return fake, state, sessions, tmp_path


def record(state: Path, session_id: str, pane: str, status: str, updated_at: int, pid: int | None = None, **extra):
    data = {
        "schema": 1,
        "sessionId": session_id,
        "pid": os.getpid() if pid is None else pid,
        "status": status,
        "cwd": extra.get("cwd", "/tmp/project"),
        "sessionName": extra.get("name", ""),
        "paneId": pane,
        "paneTty": extra.get("tty", f"/dev/tty{pane[1:]}"),
        "updatedAt": updated_at,
        "tmuxSocket": extra.get("socket", SOCKET),
        "reportsTo": extra.get("reports_to", ""),
    }
    if data["tmuxSocket"] is None:
        del data["tmuxSocket"]
    path = state / f"{session_id}.json"
    path.write_text(json.dumps(data))
    return path


def dead_pid() -> int:
    process = subprocess.Popen(["true"])
    process.wait()
    return process.pid


@pytest.fixture(scope="session")
def template_db(tmp_path_factory):
    """An empty database migrated by the runtime's own `migrate`, built once per test run."""
    path = tmp_path_factory.mktemp("template") / "apple-pi.db"
    source = REPO / "components" / "session-state" / "src"
    script = (
        "import { DatabaseSync } from 'node:sqlite';"
        f"import {{ migrate }} from {json.dumps((source / 'schema.ts').as_uri())};"
        f"const db = new DatabaseSync({json.dumps(str(path))}); migrate(db); db.close();"
    )
    subprocess.run(
        ["node", "--import", (source / "register.mjs").as_uri(), "--input-type=module", "-e", script],
        check=True,
        capture_output=True,
    )
    return path


class Runtime:
    """A fake session-state runtime: records each JSON line sent to its socket."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.lines: list[dict] = []
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(str(path))
        self.server.listen()
        threading.Thread(target=self.serve, daemon=True).start()

    def serve(self) -> None:
        while True:
            try:
                connection, _ = self.server.accept()
            except OSError:
                return
            with connection, connection.makefile() as reader:
                self.lines.extend(json.loads(line) for line in reader if line.strip())

    def commands(self) -> list[tuple[str, dict]]:
        # The socket thread reads after the client has sent; give it a moment.
        time.sleep(0.1)
        return [(line["sessionId"], line["command"]) for line in self.lines]


class World:
    """A session-state database and a fake runtime, with helpers that record rows as the runtime would."""

    def __init__(self, db: Path, runtime: Runtime, tmux: FakeTmux, tmp_path: Path) -> None:
        self.db, self.runtime, self.tmux, self.tmp_path = db, runtime, tmux, tmp_path
        self.socket = os.path.realpath(SOCKET)

    def execute(self, sql: str, *params) -> None:
        with sqlite3.connect(self.db) as db:
            db.execute(sql, params)
        db.close()

    def add(
        self,
        session_id: str,
        pane: str | None,
        run_state: str = "idle",
        *,
        name: str | None = None,
        cwd: str = "/tmp/project",
        updated_at: float | None = None,
        prompt: dict | None = None,
        needs_you_since: float | None = None,
        kind: str = "root",
        generation: int = 1,
        incarnation: int | None = None,
        process_state: str = "alive",
        ended: bool = False,
        socket: str | None = None,
        **facts,
    ) -> None:
        """A session with one incarnation in `pane` (added to fake tmux too); times are in seconds."""
        now = int(time.time() * 1000)
        ms = lambda at: None if at is None else int(at * 1000)  # noqa: E731
        columns = {
            "id": session_id,
            "kind": kind,
            "cwd": cwd,
            "name": name,
            "run_state": run_state,
            "generation": generation,
            "source": "bridge",
            "updated_at": ms(updated_at) or now,
            "prompt": json.dumps(prompt) if prompt else None,
            "needs_you_since": ms(needs_you_since),
            **{key: json.dumps(value) if isinstance(value, dict) else value for key, value in facts.items()},
        }
        self.execute(
            f"insert into sessions ({', '.join(columns)}) values ({', '.join('?' * len(columns))})", *columns.values()
        )
        self.execute(
            "insert into incarnations (session_id, generation, pid, process_started_at, process_state, started_at, "
            "ended_at, source, updated_at, tmux_socket, pane_id) values (?, ?, 1, 0, ?, 0, ?, 'bridge', 0, ?, ?)",
            session_id,
            incarnation or generation,
            process_state,
            now if ended else None,
            socket or self.socket,
            pane,
        )
        if pane is None:
            return
        if pane not in self.tmux.panes:
            self.tmux.add_pane(pane)
        for sql, *params in (
            ("insert or ignore into tmux_sessions values (?, '$1', 'work', 'tmux', 0)", self.socket),
            ("insert or ignore into tmux_windows values (?, '@1', 'pi', 'tmux', 0)", self.socket),
            ("insert or ignore into tmux_window_links values (?, '$1:@1', '$1', '@1', 1, 'tmux', 0)", self.socket),
            (
                "insert or ignore into tmux_panes values (?, ?, '@1', ?, 1, 'node', '/tmp', 0, 0, 'tmux', 0)",
                self.socket,
                pane,
                f"/dev/tty{pane[1:]}",
            ),
        ):
            self.execute(sql, *params)

    def tool_started(self, session_id: str, name: str, arg: str | None, at: float) -> None:
        self.execute(
            "insert into events (at, source, session_id, generation, type, data) values (?, 'bridge', ?, 1, "
            "'tool_started', ?)",
            int(at * 1000),
            session_id,
            json.dumps({"id": f"call-{at}", "name": name, "arg": arg}),
        )

    def task(self, bundle_name: str, text: str) -> str:
        bundle = self.tmp_path / ".ledger" / bundle_name
        bundle.mkdir(parents=True)
        (bundle / "task.md").write_text(text)
        return str(bundle)


@pytest.fixture
def world(template_db, tmp_path, monkeypatch):
    fake = FakeTmux()
    db = tmp_path / "apple-pi.db"
    shutil.copy(template_db, db)
    # macOS limits Unix socket paths to about 104 bytes; pytest's tmp_path is longer.
    socket_dir = Path(tempfile.mkdtemp(dir="/tmp"))
    runtime = Runtime(socket_dir / "rt.sock")
    monkeypatch.setattr(model, "DB_PATH", db)
    monkeypatch.setattr(model, "SOCKET_PATH", runtime.path)
    monkeypatch.setattr(model, "tmux", fake)
    monkeypatch.setattr(sidebar, "tmux", fake)
    monkeypatch.setattr(dashboard, "tmux", fake)
    yield World(db, runtime, fake, tmp_path)
    runtime.server.close()
    shutil.rmtree(socket_dir, ignore_errors=True)
