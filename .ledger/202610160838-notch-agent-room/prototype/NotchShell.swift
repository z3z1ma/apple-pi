// PROTOTYPE: a borderless panel over the MacBook notch that hosts web/index.html and feeds it live pi agents.
import AppKit
import WebKit

final class NotchPanel: NSPanel {
	override var canBecomeKey: Bool { false }
	override var canBecomeMain: Bool { false }
}

final class Shell: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
	let prototypeDir: URL
	let repoDir: URL
	var panel: NotchPanel!
	var web: WKWebView!
	var hitRect = CGRect.zero
	var hovering = false
	var feed: Process?
	var feedBuffer = Data()

	init(prototypeDir: URL) {
		self.prototypeDir = prototypeDir
		var dir = prototypeDir
		while !FileManager.default.fileExists(atPath: dir.appendingPathComponent("components/tmux-sessions").path) {
			dir = dir.deletingLastPathComponent()
		}
		repoDir = dir
	}

	func applicationDidFinishLaunching(_: Notification) {
		let screen = NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main!
		let notchHeight = screen.safeAreaInsets.top > 0 ? screen.safeAreaInsets.top : 32
		let left = screen.auxiliaryTopLeftArea?.width ?? 0
		let right = screen.auxiliaryTopRightArea?.width ?? 0
		let notchWidth = left > 0 ? screen.frame.width - left - right : 185
		let size = NSSize(width: 720, height: 460)
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
		config.userContentController.addUserScript(
			WKUserScript(source: geometry, injectionTime: .atDocumentStart, forMainFrameOnly: true))
		web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
		web.setValue(false, forKey: "drawsBackground")
		web.underPageBackgroundColor = .clear
		panel.contentView = web
		let webDir = prototypeDir.appendingPathComponent("web")
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

	/// Let clicks reach the panel only inside the shape the page reports; tell the page when the pointer enters or leaves it.
	func track() {
		let mouse = NSEvent.mouseLocation
		let local = CGPoint(x: mouse.x - panel.frame.minX, y: panel.frame.maxY - mouse.y)
		let inside = hitRect.contains(local)
		panel.ignoresMouseEvents = !inside
		if inside != hovering {
			hovering = inside
			web.evaluateJavaScript("window.notch && window.notch.hover(\(inside))")
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
		case "focus":
			focus(session: body["tmuxSession"] as? String ?? "", pane: body["paneId"] as? String ?? "")
		default:
			break
		}
	}

	func focus(session: String, pane: String) {
		let process = Process()
		process.executableURL = repoDir.appendingPathComponent("components/notify/scripts/focus-tmux.sh")
		process.arguments = [session, "", pane]
		try? process.run()
	}

	/// The feed holds only the pipe's write end, so it dies of a broken pipe within a second of this shell exiting.
	func startFeed() {
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
		process.arguments = ["uv", "run", "--no-project", "python", prototypeDir.appendingPathComponent("feed.py").path]
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

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let shell = Shell(prototypeDir: URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL)
app.delegate = shell
app.run()
