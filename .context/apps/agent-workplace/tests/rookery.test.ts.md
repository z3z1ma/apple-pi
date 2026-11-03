## file

The rookery backend runs over a real session-state runtime. Faux sessions mail through the bridge's `send_mail`. Mail to a stopped session waits. The operator's letters are `mail` commands with receipts. The awake fixture answers every turn with "noted".
Why: a fake mail path would not prove the bridge command and waiting-mail contract.
