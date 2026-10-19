## file

Raw HTML renders as escaped text, links as a titled span, and images as their alt text; the result goes into `dangerouslySetInnerHTML`.
Why: transcripts are untrusted (tool output, web pages the agent read); the window must never run script, navigate, or load remote content (its CSP allows only `self` and `data:`).
Coupled: apps/agent-world/web/index.html
