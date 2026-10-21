// A borderless panel over the MacBook notch that hosts web/index.html and shows it the live pi agents, read from the
// session-state database once a second.
// Usage: pi-notch <web dir> <focus script>, or pi-notch --feed-once to print the agents once and exit.
import AppKit
import SQLite3
import WebKit

/// The session-state database, only read here; the runtime is its only writer, so choices go to the runtime as commands.
final class Store {
	let dbPath: String
	let socketPath: String
	var db: OpaquePointer?
	/// The last tool each session started, from `tool_started` events read up to `lastSeq`.
	var lastTools: [String: (tool: String, detail: String)] = [:]
	var lastSeq: Int64 = 0
	let saves = DispatchQueue(label: "notch.saves")

	init(stateDir: String) {
		dbPath = stateDir + "/apple-pi.db"
		socketPath = stateDir + "/apple-pi.sock"
	}

	/// Opened on first use, and retried on the next read until the database exists. Opened for writing but made
	/// query-only: a read-only connection cannot read a WAL database whose `-shm` file is gone, as it is while the runtime
	/// is down.
	func connection() -> OpaquePointer? {
		if db == nil {
			var handle: OpaquePointer?
			if sqlite3_open_v2(dbPath, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK {
				sqlite3_exec(handle, "pragma query_only = 1", nil, nil, nil)
				sqlite3_busy_timeout(handle, 200)
				db = handle
			} else {
				sqlite3_close(handle)
			}
		}
		return db
	}

	/// Each row of `sql` as its columns' text (nil for null); nil when the query fails, such as before the database exists.
	func rows(_ sql: String, _ bind: Int64? = nil) -> [[String?]]? {
		guard let db = connection() else { return nil }
		var statement: OpaquePointer?
		guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
			sqlite3_finalize(statement)
			return nil
		}
		defer { sqlite3_finalize(statement) }
		if let bind { sqlite3_bind_int64(statement, 1, bind) }
		var result: [[String?]] = []
		var step = sqlite3_step(statement)
		while step == SQLITE_ROW {
			result.append(
				(0..<sqlite3_column_count(statement)).map { column in
					sqlite3_column_text(statement, column).map { String(cString: $0) }
				})
			step = sqlite3_step(statement)
		}
		// A read that stops early (busy, I/O error) is a failure, not fewer agents.
		guard step == SQLITE_DONE else {
			FileHandle.standardError.write(Data("notch: database read failed: \(String(cString: sqlite3_errmsg(db)))\n".utf8))
			return nil
		}
		return result
	}

	/// The saved choices as a JSON object literal; anything unreadable starts empty.
	func savedChoices() -> String {
		rows("select value from preferences where key = 'notch'")?.first?[0] ?? "{}"
	}

	/// The live top-level sessions bound to a tmux pane, as the page reads them: those that need you first, oldest first,
	/// then working and quiet ones, most recently changed first. Nil when the database cannot be read.
	func feed() -> [[String: Any]]? {
		guard
			let sessions = rows(
				"""
				select s.id, s.name, s.cwd, s.run_state, s.prompt is not null, s.needs_you_since is not null, s.current_tool,
					s.current_tool_arg, json_extract(s.current_task, '$.bundle'), s.updated_at / 1000, i.tmux_socket, i.pane_id,
					(select t.name from tmux_panes p
						join tmux_window_links l on l.socket = p.socket and l.window_id = p.window_id
						join tmux_sessions t on t.socket = l.socket and t.id = l.session_id
						where p.socket = i.tmux_socket and p.id = i.pane_id order by l.session_id limit 1)
				from sessions s join incarnations i on i.session_id = s.id and i.generation = s.generation
				where s.kind = 'root' and i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost')
					and i.pane_id is not null
				"""),
			let started = rows(
				"select seq, session_id, json_extract(data, '$.name'), json_extract(data, '$.arg') from events where seq > ? and type = 'tool_started' order by seq",
				lastSeq)
		else { return nil }
		for event in started {
			lastSeq = Int64(event[0]!)!
			if let id = event[1] { lastTools[id] = (event[2] ?? "", event[3] ?? "") }
		}
		lastTools = lastTools.filter { id, _ in sessions.contains { $0[0] == id } }
		let agents = sessions.map { row -> [String: Any] in
			let id = row[0]!
			// What it does now; a working agent keeps an earlier unseen result as `unseen`.
			let state =
				row[4] == "1" ? "waiting" : row[3] != "idle" ? "working" : row[5] == "1" ? "done" : "quiet"
			let project = URL(fileURLWithPath: row[2]!).lastPathComponent
			let last = row[6].map { (tool: $0, detail: row[7] ?? "") } ?? lastTools[id]
			return [
				"id": id,
				"name": row[1] ?? row[8].flatMap(taskTitle) ?? project,
				"project": project,
				"state": state,
				"unseen": row[4] != "1" && row[5] == "1",
				"tool": last?.tool ?? "",
				"detail": last?.detail ?? "",
				"tmuxSession": row[12] ?? "",
				"paneId": row[11]!,
				"tmuxSocket": row[10] ?? "",
				"updatedAt": Int(row[9]!)!,
			]
		}
		let rank = ["waiting": 0, "done": 0, "working": 1, "quiet": 2]
		return agents.sorted { a, b in
			let (ra, rb) = (rank[a["state"] as! String]!, rank[b["state"] as! String]!)
			if ra != rb { return ra < rb }
			let (ta, tb) = (a["updatedAt"] as! Int, b["updatedAt"] as! Int)
			return ra == 0 ? ta < tb : ta > tb
		}
	}

	/// The title of a ledger task bundle: its `task.md`'s first `# ` heading.
	func taskTitle(bundle: String) -> String? {
		guard let text = try? String(contentsOfFile: bundle + "/task.md", encoding: .utf8) else { return nil }
		return text.split(separator: "\n").first { $0.hasPrefix("# ") }.map { $0.dropFirst(2).trimmingCharacters(in: .whitespaces) }
	}

	/// Send the choices to the runtime as a `set_preference` command, in order, off the main thread.
	func save(_ choices: [String: Any]) {
		let request: [String: Any] = [
			"type": "command", "commandId": UUID().uuidString, "sessionId": "notch",
			"command": ["kind": "set_preference", "key": "notch", "value": choices],
		]
		guard var line = try? JSONSerialization.data(withJSONObject: request) else { return }
		line.append(0x0A)
		saves.async { [socketPath] in
			if let failure = Store.send(line, to: socketPath) { print("notch: choices not saved: \(failure)") }
		}
	}

	/// Write one request line and wait (two seconds at most) for its last receipt; returns why it failed, or nil.
	static func send(_ line: Data, to path: String) -> String? {
		let fd = socket(AF_UNIX, SOCK_STREAM, 0)
		guard fd >= 0 else { return "no socket" }
		defer { close(fd) }
		var on: Int32 = 1
		setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
		var timeout = timeval(tv_sec: 2, tv_usec: 0)
		setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
		var address = sockaddr_un()
		address.sun_family = sa_family_t(AF_UNIX)
		let bytes = Array(path.utf8)
		guard bytes.count < MemoryLayout.size(ofValue: address.sun_path) else { return "socket path too long" }
		withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes) }
		let connected = withUnsafePointer(to: &address) {
			$0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
				connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
			}
		}
		guard connected == 0 else { return "the runtime at \(path) is not running" }
		let written = line.withUnsafeBytes { write(fd, $0.baseAddress, line.count) }
		guard written == line.count else { return "write failed" }
		var received = Data()
		var buffer = [UInt8](repeating: 0, count: 4096)
		while true {
			let count = read(fd, &buffer, buffer.count)
			if count <= 0 { return "no answer from the runtime" }
			received.append(contentsOf: buffer[0..<count])
			for receipt in received.split(separator: 0x0A) {
				guard let object = try? JSONSerialization.jsonObject(with: Data(receipt)) as? [String: Any] else { continue }
				if object["stage"] as? String == "applied" { return nil }
				if object["stage"] as? String == "failed" { return object["reason"] as? String ?? "failed" }
			}
		}
	}
}

final class NotchPanel: NSPanel {
	override var canBecomeKey: Bool { false }
	override var canBecomeMain: Bool { false }
}

final class Shell: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
	let webDir: URL
	let focusScript: URL
	let store: Store
	var panel: NotchPanel!
	var web: WKWebView!
	var hitRect = CGRect.zero
	var hovering = false

	init(webDir: URL, focusScript: URL, store: Store) {
		self.webDir = webDir
		self.focusScript = focusScript
		self.store = store
	}

	/// Move the panel to the top centre of the screen with a notch, or of the main screen when no notch shows (an external
	/// display with the lid closed). Returns the geometry the page sizes its pill from, as a JavaScript object literal.
	func place() -> String {
		let screen = NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main!
		let notchHeight = screen.safeAreaInsets.top > 0 ? screen.safeAreaInsets.top : 32
		let left = screen.auxiliaryTopLeftArea?.width ?? 0
		let right = screen.auxiliaryTopRightArea?.width ?? 0
		let notchWidth = left > 0 ? screen.frame.width - left - right : 185
		let size = panel.frame.size
		panel.setFrame(
			NSRect(
				x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - size.height,
				width: size.width, height: size.height),
			display: true)
		print("notch: \(Int(notchWidth))x\(Int(notchHeight)) on \(screen.localizedName)")
		return "{notchWidth: \(notchWidth), notchHeight: \(notchHeight), width: \(size.width), height: \(size.height)}"
	}

	func applicationDidFinishLaunching(_: Notification) {
		let size = NSSize(width: 1100, height: 500)
		panel = NotchPanel(
			contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel],
			backing: .buffered, defer: false)
		panel.isOpaque = false
		panel.backgroundColor = .clear
		panel.hasShadow = false
		panel.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 3)
		panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
		panel.ignoresMouseEvents = true

		let config = WKWebViewConfiguration()
		config.userContentController.add(self, name: "notch")
		let startup = "window.notchGeometry = \(place()); window.notchState = \(store.savedChoices());"
		config.userContentController.addUserScript(
			WKUserScript(source: startup, injectionTime: .atDocumentStart, forMainFrameOnly: true))
		web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
		web.setValue(false, forKey: "drawsBackground")
		web.underPageBackgroundColor = .clear
		panel.contentView = web
		web.loadFileURL(webDir.appendingPathComponent("index.html"), allowingReadAccessTo: webDir)
		panel.orderFrontRegardless()

		NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] _ in self?.track() }
		NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] event in
			self?.track()
			return event
		}
		NotificationCenter.default.addObserver(
			forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
		) { [weak self] _ in
			guard let self else { return }
			self.web.evaluateJavaScript("window.notch?.geometry?.(\(self.place()))")
		}
		Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }.fire()
	}

	/// Show the page the agents as they are now; while the database cannot be read, the page keeps the last ones.
	func refresh() {
		guard let agents = store.feed(), let json = try? JSONSerialization.data(withJSONObject: agents) else { return }
		web.evaluateJavaScript("window.notch && window.notch.update(\(String(decoding: json, as: UTF8.self)))")
	}

	/// Let clicks reach the panel only inside the shape the page reports; tell the page when the pointer enters or leaves it,
	/// and where it is: a panel that never becomes key gets no mouse-move events in its web view.
	func track() {
		let mouse = NSEvent.mouseLocation
		let local = CGPoint(x: mouse.x - panel.frame.minX, y: panel.frame.maxY - mouse.y)
		let inside = hitRect.contains(local)
		panel.ignoresMouseEvents = !inside
		if inside != hovering {
			hovering = inside
			web.evaluateJavaScript("window.notch && window.notch.hover(\(inside))")
		}
		if inside {
			web.evaluateJavaScript("window.notch?.pointer?.(\(local.x), \(local.y))")
		}
	}

	func userContentController(_: WKUserContentController, didReceive message: WKScriptMessage) {
		guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
		switch type {
		case "hit":
			hitRect = CGRect(
				x: body["x"] as? Double ?? 0, y: body["y"] as? Double ?? 0,
				width: body["w"] as? Double ?? 0, height: body["h"] as? Double ?? 0)
			track()
		case "save":
			if let choices = body["state"] as? [String: Any] { store.save(choices) }
		case "focus":
			focus(
				session: body["tmuxSession"] as? String ?? "", pane: body["paneId"] as? String ?? "",
				socket: body["tmuxSocket"] as? String ?? "")
		default:
			break
		}
	}

	func focus(session: String, pane: String, socket: String) {
		let process = Process()
		process.executableURL = focusScript
		process.arguments = [session, "", pane]
		process.environment = ProcessInfo.processInfo.environment.merging(["TMUX_SOCKET": socket]) { $1 }
		try? process.run()
	}
}

/// One panel per Mac. Holds an exclusive lock on `<pi home>/state/notch.lock` for the panel's lifetime and records its pid
/// and executable there; the executable's name carries the build hash. A panel of the same build already holding the lock
/// makes this start a duplicate; one of another build is told to quit and replaced. The kernel drops the lock when a panel
/// dies, however it dies.
///
/// Several Pis often start together, so several starts can race to replace the same panel. Each one asks only the panel it
/// first saw to quit, and steps aside if the lock then passes to anyone else, so no start waits behind a newer panel.
func claimPanel(stateDir: String) -> Int32 {
	let path = stateDir + "/notch.lock"
	// Close-on-exec, so focus children never inherit the lock and keep it after this panel dies.
	let fd = open(path, O_RDWR | O_CREAT | O_CLOEXEC, 0o644)
	guard fd >= 0 else {
		FileHandle.standardError.write(Data("pi-notch: cannot open \(path)\n".utf8))
		exit(1)
	}
	let executable = CommandLine.arguments[0]
	var replacing: String?
	while flock(fd, LOCK_EX | LOCK_NB) != 0 {
		let record = (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
		let holder = record.split(separator: "\n").map(String.init)
		// An empty record is a panel that has just taken the lock and not yet written it.
		if holder.count == 2 {
			if holder[1] == executable { exit(0) }
			if replacing == nil {
				replacing = record
				if let pid = pid_t(holder[0]) { kill(pid, SIGTERM) }
			} else if record != replacing {
				exit(0)
			}
		}
		usleep(100_000)
	}
	// The lock can pass straight from the panel this start replaced to a rival start, then on to this one: step aside.
	if let replacing, ((try? String(contentsOfFile: path, encoding: .utf8)) ?? "") != replacing { exit(0) }
	ftruncate(fd, 0)
	let record = Data("\(getpid())\n\(executable)\n".utf8)
	_ = record.withUnsafeBytes { pwrite(fd, $0.baseAddress, record.count, 0) }
	return fd
}

let stateDir = (ProcessInfo.processInfo.environment["PI_CODING_AGENT_DIR"] ?? NSHomeDirectory() + "/.pi/agent") + "/state"
let store = Store(stateDir: stateDir)
let arguments = Array(CommandLine.arguments.dropFirst())
if arguments == ["--feed-once"] {
	let json = try! JSONSerialization.data(withJSONObject: store.feed() ?? [], options: [.sortedKeys])
	print(String(decoding: json, as: UTF8.self))
	exit(0)
}
guard arguments.count == 2 else {
	FileHandle.standardError.write(Data("usage: pi-notch <web dir> <focus script> | pi-notch --feed-once\n".utf8))
	exit(64)
}
try? FileManager.default.createDirectory(atPath: stateDir, withIntermediateDirectories: true)
let panelLock = claimPanel(stateDir: stateDir)
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let urls = arguments.map { URL(fileURLWithPath: $0).standardizedFileURL }
let shell = Shell(webDir: urls[0], focusScript: urls[1], store: store)
app.delegate = shell
app.run()
