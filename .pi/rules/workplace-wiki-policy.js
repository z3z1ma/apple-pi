if (/\bloadWikiGraph\(\s*[\w.]+(?:\s*,\s*[\w.]+)?\s*\)/.test(event.content))
	return "Workplace wiki reads pass the workspace path policy to the shared loader before traversal reads metadata or Markdown.";
