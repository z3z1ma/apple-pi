# Anthropic response watchdog

The watchdog bounds two waits on direct Anthropic streaming requests. An accepted request can keep sending `ping` events without starting a response or making further progress. These bytes satisfy a network byte-idle timeout but do not establish model progress.

## Scope and deadlines

Only successful HTTPS `POST` responses from `api.anthropic.com/v1/messages` with the `text/event-stream` content type are watched. A query string on that path is allowed. Gateways, other hosts, HTTP, other paths, non-streaming responses and unsuccessful statuses keep their existing behavior. Authentication and provider selection stay with Pi.

Each HTTP request has one timer:

| Stage | Deadline | Progress that resets it |
| --- | --- | --- |
| After response headers | 45 seconds to the first non-ping SSE event | A complete SSE event other than `ping` |
| After the first non-ping event | 15 minutes between non-ping events | Any further complete non-ping event, including thinking and tool-argument events |

The timer ends with the HTTP response, on completion or error. It does not cover the preceding wait for headers, total response duration while progress continues, or later local tool execution. Pi's existing transport timeouts still apply and can end a request sooner.

Fifteen minutes is the operator's chosen silent-progress bound, not proof that a remote computation is dead. Legitimate thinking can arrive in batches or remain silent. Such a request can also reach this bound; no false-positive rate has been measured.

## Failure and retries

At a deadline, the watchdog fails the individual Undici request with an error. It does not cancel the user's run signal, replace the provider, change authentication, or send a continuation prompt. Pi's normal retry classification and configured retry limits decide whether to try again or finish with an error. User cancellation remains cancellation rather than a retry request.

Concurrent requests have separate timers. One stalled response does not stop another healthy response. Once a response ends with a local tool call, the tool can run longer than either deadline; the next model request gets its own watchdog.

## Lifecycle and privacy

The package loads the extension in root sessions, and the intern runner loads it explicitly in each separate process. Its process-wide observation also covers matching requests made by internal sessions in that process, such as the pair programmer and `/btw`. Reload an existing root session to activate a newly installed version; no session-state daemon restart is needed.

The extension acquires diagnostics subscriptions on `session_start` and releases its ownership on `session_shutdown`, including reload. A process-wide shared owner prevents duplicate enforcement when separate extension module graphs coexist. Subscriptions remain while another owner is active; the last release also removes outstanding timers and decoder state. Individual response completion, cancellation and errors release their request state independently.

The watcher reads Undici response diagnostics rather than patching global fetch. It decodes identity, gzip, Brotli, deflate and Zstandard bodies, including stacked supported encodings, and recognizes SSE frames across byte/chunk and line boundaries. Other encodings remain with Pi's native handling. The parser tracks event framing and ping identity without storing event data. Compressed bytes and incomplete UTF-8 sequences exist only as decoder working state and are released on cleanup. There is no request logging, header recording, probe UI or separate configuration surface.

## Verification boundary

Focused tests use a disposable Node process with Pi's configured Undici transport, a local HTTPS SSE server and loopback CONNECT proxy. The real Anthropic adapter and AgentSession retry loop run against synthetic responses and credentials. These tests cover ping-only stalls, recovery, exhaustion and disabled retries; cancellation; concurrent streams; compressed healthy progress, including Zstandard; thinking/tool arguments; and a local tool that outlasts the scaled response deadline. A post-tool stall control checks that the completed result remains in both subsequent requests and the tool executes only once. Additional diagnostics controls cover exact deadline values, exclusions, framing, decoder cleanup, shared ownership and SDK reload.

This is local integration evidence. It does not prove recovery from a live Anthropic incident, a safe upper bound for legitimate silent thinking, or a measured false-positive rate.
