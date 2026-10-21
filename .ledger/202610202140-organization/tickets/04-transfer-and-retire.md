# 04: Transfer and retire

**What to build:** A manager can move a person under another manager and record that a person has left. `transfer_peer_session(session_id, manager)` changes the person's manager in the database and in its running bridge, refuses a move that would make a cycle or leave the org, moves a manager together with its team, mails the person, the old manager, and the new manager, and sends the person's later close notices to the new manager. `retire_peer_session(session_id, reason)` records the date and reason, closes the person if it runs, and lists it as a former member in the directory; `reopen_peer_session` by a manager clears the retirement. The database keeps every manager change for the record.

**Blocked by:** 03 The org tree, the directory, and the charters

**Status:** ready-for-agent

- [ ] After a transfer, the moved person's directory entry shows the new manager, all three parties have received mail naming the move, and a close notice from the moved person reaches the new manager, not the old.
- [ ] Transferring a manager moves its reports with it, and the directory shows the subtree under the new manager.
- [ ] A transfer that would put a person under its own report, or under a session outside its org, fails with a reason and changes nothing.
- [ ] A retired person appears in the directory under former members with its reason and is absent from the active list; reopening it by a manager returns it to the active list.
- [ ] The manager-changes record lists each move with from, to, and time.
