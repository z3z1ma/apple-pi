import sqlite3, json, statistics as st, os, collections, bisect
db = sqlite3.connect("file:" + os.path.expanduser("~/.pi/agent/state/apple-pi.db") + "?mode=ro", uri=True)
q = lambda s, *a: db.execute(s, a).fetchall()
H = 3600_000
out = {}
roots = {r[0] for r in q("select id from sessions where kind='root'")}
# A. cost attribution to open assignments
asg = collections.defaultdict(list)
for p, t, a, e in q("select person, task_id, assigned_at, coalesce(ended_at, 9e15) from assignments"):
    asg[p].append((a, e, t))
att = collections.Counter(); tot = 0.0; per_task = collections.Counter()
for sid, at, data in q("select session_id, at, data from events where type='cost_changed'"):
    d = json.loads(data); delta = (d["to"] or 0) - (d["from"] or 0)
    if delta <= 0: continue
    tot += delta
    open_ = [t for a, e, t in asg.get(sid, []) if a <= at < e]
    k = "one" if len(open_) == 1 else ("none" if not open_ else "several")
    att[k] += delta
    if len(open_) == 1: per_task[open_[0]] += delta
out["cost_total_usd"] = round(tot, 2)
out["cost_share"] = {k: round(v / tot, 3) for k, v in att.items()}
vals = sorted(per_task.values())
out["cost_per_task_usd"] = {"tasks": len(vals), "median": round(st.median(vals), 2), "p90": round(vals[int(.9 * len(vals))], 2), "max": round(vals[-1], 2)}
# B. manager fan-in and reply latency
mgr = {r[0] for r in q("select id from sessions where manages=1")} | {r[0] for r in q("select distinct reports_to from sessions where reports_to is not null")}
msgs = q("select thread_id, sender, at, seq from thread_messages order by seq")
by_thread = collections.defaultdict(list)
for th, s, at, seq in msgs: by_thread[th].append((s, at))
parts = collections.defaultdict(set)
for th, p, d in q("select thread_id, participant, delivery from thread_participants"):
    if d == "push": parts[th].add(p)
fan = collections.Counter(); lat = collections.defaultdict(list)
for th, ms in by_thread.items():
    for i, (s, at) in enumerate(ms):
        for p in parts[th]:
            if p == s or p not in mgr: continue
            fan[p] += 1
            nxt = next((a2 for s2, a2 in ms[i + 1:] if s2 == p), None)
            if nxt: lat[p].append((nxt - at) / 60000)
name = dict(q("select id, coalesce(name, id) from sessions"))
out["manager_fan_in"] = sorted([{"who": name.get(p, p)[:24], "inbound_msgs": n, "replied": len(lat[p]), "median_reply_min": round(st.median(lat[p]), 1) if lat[p] else None, "p90_reply_min": round(sorted(lat[p])[int(.9 * len(lat[p]))], 1) if lat[p] else None} for p, n in fan.items()], key=lambda x: -x["inbound_msgs"])[:6]
# C. idle while holding open work (session awake, run_state idle)
rs = collections.defaultdict(list)
for sid, at, data in q("select session_id, at, data from events where type='run_state' order by seq"):
    rs[sid].append((at, json.loads(data)["to"]))
ends = collections.defaultdict(list)
for sid, at in q("select session_id, at from events where type='incarnation_ended'"): ends[sid].append(at)
idle_open = 0.0; busy_open = 0.0
for sid, tl in rs.items():
    if sid not in asg: continue
    for i, (at, state) in enumerate(tl):
        nxt = tl[i + 1][0] if i + 1 < len(tl) else at
        e_after = [e for e in ends[sid] if at <= e < nxt]
        nxt = min([nxt] + e_after)
        span = nxt - at
        if span <= 0: continue
        if any(a <= at < e for a, e, _ in asg[sid]):
            if state == "idle": idle_open += span
            else: busy_open += span
out["awake_hours_with_open_work"] = {"idle": round(idle_open / H, 1), "working": round(busy_open / H, 1)}
# D. rehydration: tool calls between a reopen/compaction and the first edit/write
calls = collections.defaultdict(list)
for sid, at, tool in q("select session_id, at, tool from messages where role='tool_call' or part<>'' order by at"):
    if tool: calls[sid].append((at, tool))
starts = [(s, a, "reopen") for s, a, g in q("select session_id, at, generation from events where type='incarnation_started' and generation>1")]
starts += [(s, a, "compaction") for s, a, d in q("select session_id, at, data from events where type='run_state'") if json.loads(d)["to"] == "compacting"]
rh = collections.defaultdict(list)
for sid, at, kind in starts:
    cs = [c for c in calls[sid] if c[0] > at]
    idx = next((i for i, c in enumerate(cs) if c[1] in ("edit", "write")), None)
    if idx is None: continue
    reads = sum(1 for c in cs[:idx] if c[1] in ("read", "bash", "search_session", "explore", "revisit_note"))
    rh[kind].append(reads)
out["calls_before_first_edit"] = {k: {"n": len(v), "median": st.median(v), "p90": sorted(v)[int(.9 * len(v))]} for k, v in rh.items()}
# E. the same file read by two or more people within 24h
reads = q("select session_id, at, preview from messages where tool='read' and part<>''")
byp = collections.defaultdict(list)
for sid, at, p in reads: byp[p.strip()].append((at, sid))
dup = 0; dup_paths = 0
for p, lst in byp.items():
    lst.sort(); hit = False
    for i, (at, s) in enumerate(lst):
        if any(s2 != s and at - a2 < 24 * H for a2, s2 in lst[:i]): dup += 1; hit = True
    dup_paths += hit
out["cross_person_rereads_24h"] = {"reads": len(reads), "rereads_of_a_file_another_person_read": dup, "files": dup_paths}
# F. verification: test runs vs edits per person
ver = collections.Counter(); ed = collections.Counter()
for sid, tool, p in q("select session_id, tool, preview from messages where part<>'' and tool in ('bash','edit','write')"):
    if tool == "bash" and any(k in p for k in ("vitest", "npm test", "npm run test", "pytest", "typecheck")): ver[sid] += 1
    elif tool in ("edit", "write"): ed[sid] += 1
out["edits_vs_checks"] = {"edits": sum(ed.values()), "check_runs": sum(ver.values()), "people_editing_without_any_check": sum(1 for s in ed if ver[s] == 0)}
# G. operator attention
out["operator"] = {"threads_with_operator": q("select count(distinct thread_id) from thread_participants where participant='operator'")[0][0],
  "messages_from_operator": q("select count(*) from thread_messages where sender='operator'")[0][0],
  "ask_user_question_calls": q("select count(*) from messages where tool='ask_user_question' and part<>''")[0][0],
  "escalations": q("select count(*) from threads where subject='Escalation'")[0][0]}
out["span_days"] = round((q("select max(at)-min(at) from events")[0][0]) / (24 * H), 1)
print(json.dumps(out, indent=1))
