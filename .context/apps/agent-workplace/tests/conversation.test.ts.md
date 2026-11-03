## file

The conversation panel uses the backend API in Node, without Electron, over a real session-state runtime. Session JSONL is written and reported to the runtime index as the bridge would. A page cursor is the first entry of that page; the next page ends just before it. Seen state is the runtime's own record, which the sidebar, dashboard and notch read.
Why: a local cursor would not prove the shared seen contract.
