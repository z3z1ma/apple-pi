if (!event.path.endsWith("apps/agent-workplace/web/workplace-thread.tsx")) return;
if (/(?:const followLatest\s*=\s*useRef(?:\s*<[^>]+>)?\s*\(|followLatest\.current\s*=\s*)[^;]*\bchannel\b/.test(event.content))
	return "Start every shared thread reader at the newest page; channel metadata is separate from the operator's reading position.";
for (const [input] of event.content.matchAll(/<input\b[\s\S]*?\/>/g)) {
	if (!/\baria-label\s*=\s*["']Message page size["']/.test(input)) continue;
	if (!/(?:^|\s)disabled\s*=\s*\{\s*pending(?:\s*\|\|\s*[A-Za-z_$][\w$]*)*\s*\}/.test(input))
		return "Wait for the pending read before changing page size, so earlier-page scroll restoration cannot reposition a newest-page acknowledgment.";
}
