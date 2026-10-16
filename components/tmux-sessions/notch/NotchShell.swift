// A borderless panel over the MacBook notch that hosts web/index.html and feeds it the live pi agents.
// Usage: pi-notch <web dir> <agents.py> <focus script>
import AppKit
import WebKit

final class NotchPanel: NSPanel {
	override var canBecomeKey: Bool { false }
	override var canBecomeMain: Bool { false }
}

final class Shell: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
	let webDir: URL
	let agentsScript: URL
	let focusScript: URL
	let choicesFile: URL
	var panel: NotchPanel!
	var web: WKWebView!
	var hitRect = CGRect.zero
	var hovering = false
	var feed: Process?
	var feedBuffer = Data()

	init(webDir: URL, agentsScript: URL, focusScript: URL, choicesFile: URL) {
		self.webDir = webDir
		self.agentsScript = agentsScript
		self.focusScript = focusScript
		self.choicesFile = choicesFile
	}

	/// The saved per-session choices as a JSON object literal; anything unreadable starts empty.
	func savedChoices() -> String {
		guard let data = try? Data(contentsOf: choicesFile),
			let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
			let json = try? JSONSerialization.data(withJSONObject: object)
		else { return "{}" }
		return String(decoding: json, as: UTF8.self)
	}

	/// Atomic: written to a temporary file and renamed, so a reader never sees half a file.
	func saveChoices(_ choices: [String: Any]) {
		guard let json = try? JSONSerialization.data(withJSONObject: choices, options: [.prettyPrinted, .sortedKeys])
		else { return }
		try? json.write(to: choicesFile, options: .atomic)
	}

	func applicationDidFinishLaunching(_: Notification) {
		let screen = NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main!
		let notchHeight = screen.safeAreaInsets.top > 0 ? screen.safeAreaInsets.top : 32
		let left = screen.auxiliaryTopLeftArea?.width ?? 0
		let right = screen.auxiliaryTopRightArea?.width ?? 0
		let notchWidth = left > 0 ? screen.frame.width - left - right : 185
		let size = NSSize(width: 1100, height: 500)
		let frame = NSRect(
			x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - size.height,
			width: size.width, height: size.height)

		panel = NotchPanel(
			contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
		panel.isOpaque = false
		panel.backgroundColor = .clear
		panel.hasShadow = false
		panel.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 3)
		panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
		panel.ignoresMouseEvents = true

		let config = WKWebViewConfiguration()
		config.userContentController.add(self, name: "notch")
		let geometry =
			"window.notchGeometry = {notchWidth: \(notchWidth), notchHeight: \(notchHeight), width: \(size.width), height: \(size.height)};"
		let startup = geometry + " window.notchState = \(savedChoices());"
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
		startFeed()
		print("notch: \(Int(notchWidth))x\(Int(notchHeight)) on \(screen.localizedName)")
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
			if let choices = body["state"] as? [String: Any] { saveChoices(choices) }
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

	/// The feed holds only the pipe's write end, so it dies of a broken pipe within a second of this shell exiting.
	func startFeed() {
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
		process.arguments = ["uv", "run", "--no-project", "python", agentsScript.path, "feed"]
		let pipe = Pipe()
		process.standardOutput = pipe
		pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
			let chunk = handle.availableData
			DispatchQueue.main.async { self?.consume(chunk) }
		}
		try? process.run()
		feed = process
	}

	func consume(_ chunk: Data) {
		feedBuffer.append(chunk)
		while let newline = feedBuffer.firstIndex(of: 0x0A) {
			let line = String(decoding: feedBuffer[feedBuffer.startIndex..<newline], as: UTF8.self)
			feedBuffer.removeSubrange(feedBuffer.startIndex...newline)
			web.evaluateJavaScript("window.notch && window.notch.update(\(line))")
		}
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
	// Close-on-exec, so the feed and focus children never inherit the lock and keep it after this panel dies.
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

let arguments = CommandLine.arguments.dropFirst().map { URL(fileURLWithPath: $0).standardizedFileURL }
guard arguments.count == 3 else {
	FileHandle.standardError.write(Data("usage: pi-notch <web dir> <agents.py> <focus script>\n".utf8))
	exit(64)
}
let stateDir = (ProcessInfo.processInfo.environment["PI_CODING_AGENT_DIR"] ?? NSHomeDirectory() + "/.pi/agent") + "/state"
try? FileManager.default.createDirectory(atPath: stateDir, withIntermediateDirectories: true)
let panelLock = claimPanel(stateDir: stateDir)
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let shell = Shell(
	webDir: arguments[0], agentsScript: arguments[1], focusScript: arguments[2],
	choicesFile: URL(fileURLWithPath: stateDir + "/notch.json"))
app.delegate = shell
app.run()
