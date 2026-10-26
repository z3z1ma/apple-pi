import sqlite3, json, os, collections
db = sqlite3.connect("file:" + os.path.expanduser("~/.pi/agent/state/apple-pi.db") + "?mode=ro", uri=True)
q = lambda s, *a: db.execute(s, a).fetchall()
first = q("select min(assigned_at) from assignments")[0][0]
asg = collections.defaultdict(list)
for p, a, e in q("select person, assigned_at, coalesce(ended_at, 9e15) from assignments"): asg[p].append((a, e))
c = collections.Counter(); people = collections.Counter()
for sid, at, d in q("select session_id, at, data from events where type='cost_changed' and at>=?", first):
    d = json.loads(d); x = (d["to"] or 0) - (d["from"] or 0)
    if x <= 0: continue
    k = sum(1 for a, e in asg.get(sid, []) if a <= at < e)
    c[min(k, 2)] += x
    if k == 0: people[sid] += x
t = sum(c.values()); name = dict(q("select id, coalesce(name,id) from sessions"))
print("days since first assignment:", round((q("select max(at) from events")[0][0]-first)/864e5,1))
print({k: round(v/t,3) for k, v in c.items()}, "total", round(t))
print("top unattributed:", [(name[s][:20], round(v)) for s, v in people.most_common(4)])
