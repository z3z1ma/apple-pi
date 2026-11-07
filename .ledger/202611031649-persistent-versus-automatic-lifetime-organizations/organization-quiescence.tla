---- MODULE OrganizationQuiescence ----
EXTENDS Naturals, FiniteSets
CONSTANT UnsafeSnapshot

VARIABLES input, observedIdle, connected, frozen, reservation, ticket, heldTicket,
          replyTicket, replyBinding, proofTicket, binding, up, closing, departed, unsafe
vars == <<input, observedIdle, connected, frozen, reservation, ticket, heldTicket,
          replyTicket, replyBinding, proofTicket, binding, up, closing, departed, unsafe>>

Init ==
    /\ input = "none" /\ observedIdle = TRUE /\ connected = TRUE
    /\ frozen = FALSE /\ reservation = FALSE /\ ticket = 0 /\ heldTicket = 0
    /\ replyTicket = 0 /\ replyBinding = 0 /\ proofTicket = 0 /\ binding = 0
    /\ up = TRUE /\ closing = TRUE /\ departed = FALSE /\ unsafe = FALSE

RemoteInput ==
    /\ up /\ connected /\ ~departed /\ ~reservation /\ input = "none"
    /\ input' = "accepted"
    /\ UNCHANGED <<observedIdle, connected, frozen, reservation, ticket, heldTicket,
                   replyTicket, replyBinding, proofTicket, binding, up, closing, departed, unsafe>>

LocalInput ==
    /\ ~departed /\ ~frozen /\ input = "none"
    /\ input' = "preparing"
    /\ UNCHANGED <<observedIdle, connected, frozen, reservation, ticket, heldTicket,
                   replyTicket, replyBinding, proofTicket, binding, up, closing, departed, unsafe>>

Deliver ==
    /\ up /\ connected /\ ~departed /\ input = "accepted" /\ ~frozen
    /\ input' = "preparing"
    /\ UNCHANGED <<observedIdle, connected, frozen, reservation, ticket, heldTicket,
                   replyTicket, replyBinding, proofTicket, binding, up, closing, departed, unsafe>>

Start ==
    /\ ~departed /\ input = "preparing" /\ ~frozen
    /\ input' = "active"
    /\ UNCHANGED <<observedIdle, connected, frozen, reservation, ticket, heldTicket,
                   replyTicket, replyBinding, proofTicket, binding, up, closing, departed, unsafe>>

SettleOrReject ==
    /\ ~departed /\ input # "none"
    /\ input' = "none"
    /\ UNCHANGED <<observedIdle, connected, frozen, reservation, ticket, heldTicket,
                   replyTicket, replyBinding, proofTicket, binding, up, closing, departed, unsafe>>

Observe ==
    /\ up /\ connected /\ observedIdle # (input = "none")
    /\ observedIdle' = (input = "none")
    /\ UNCHANGED <<input, connected, frozen, reservation, ticket, heldTicket,
                   replyTicket, replyBinding, proofTicket, binding, up, closing, departed, unsafe>>

Reserve ==
    /\ up /\ connected /\ closing /\ ~departed /\ ~reservation
    /\ observedIdle /\ input # "accepted" /\ ticket < 2
    /\ reservation' = TRUE /\ ticket' = ticket + 1 /\ proofTicket' = 0
    /\ UNCHANGED <<input, observedIdle, connected, frozen, heldTicket,
                   replyTicket, replyBinding, binding, up, closing, departed, unsafe>>

Agree ==
    /\ up /\ connected /\ reservation /\ ~departed /\ input = "none"
    /\ replyTicket # ticket
    /\ frozen' = TRUE /\ heldTicket' = ticket
    /\ replyTicket' = ticket /\ replyBinding' = binding
    /\ UNCHANGED <<input, observedIdle, connected, reservation, ticket,
                   proofTicket, binding, up, closing, departed, unsafe>>

ReceiveAgreement ==
    /\ up /\ connected /\ reservation /\ replyTicket = ticket
    /\ replyBinding = binding /\ proofTicket # ticket
    /\ proofTicket' = ticket
    /\ UNCHANGED <<input, observedIdle, connected, frozen, reservation, ticket, heldTicket,
                   replyTicket, replyBinding, binding, up, closing, departed, unsafe>>

Invalidate ==
    /\ up /\ reservation /\ ~departed
    /\ reservation' = FALSE /\ proofTicket' = 0
    /\ UNCHANGED <<input, observedIdle, connected, frozen, ticket, heldTicket,
                   replyTicket, replyBinding, binding, up, closing, departed, unsafe>>

Release ==
    /\ up /\ connected /\ ~reservation /\ proofTicket = 0 /\ frozen /\ ~departed
    /\ frozen' = FALSE /\ heldTicket' = 0
    /\ UNCHANGED <<input, observedIdle, connected, reservation, ticket,
                   replyTicket, replyBinding, proofTicket, binding, up, closing, departed, unsafe>>

Disconnect ==
    /\ connected
    /\ connected' = FALSE /\ reservation' = FALSE /\ proofTicket' = 0
    /\ UNCHANGED <<input, observedIdle, frozen, ticket, heldTicket,
                   replyTicket, replyBinding, binding, up, closing, departed, unsafe>>

Reconnect ==
    /\ up /\ ~connected /\ binding < 2
    /\ connected' = TRUE /\ binding' = binding + 1 /\ reservation' = FALSE /\ proofTicket' = 0
    /\ UNCHANGED <<input, observedIdle, frozen, ticket, heldTicket,
                   replyTicket, replyBinding, up, closing, departed, unsafe>>

CancelClose ==
    /\ up /\ closing /\ ~departed
    /\ closing' = FALSE
    /\ UNCHANGED <<input, observedIdle, connected, frozen, reservation, ticket, heldTicket,
                   replyTicket, replyBinding, proofTicket, binding, up, departed, unsafe>>

Crash ==
    /\ up
    /\ up' = FALSE /\ connected' = FALSE /\ reservation' = FALSE /\ proofTicket' = 0
    /\ UNCHANGED <<input, observedIdle, frozen, ticket, heldTicket,
                   replyTicket, replyBinding, binding, closing, departed, unsafe>>

Restart ==
    /\ ~up
    /\ up' = TRUE
    /\ UNCHANGED <<input, observedIdle, connected, frozen, reservation, ticket, heldTicket,
                   replyTicket, replyBinding, proofTicket, binding, closing, departed, unsafe>>

Commit ==
    /\ up /\ closing /\ ~departed
    /\ IF UnsafeSnapshot THEN observedIdle
       ELSE reservation /\ connected /\ proofTicket = ticket /\ ticket > 0
            /\ frozen /\ heldTicket = ticket
    /\ departed' = TRUE
    /\ unsafe' = (input # "none" \/ ~connected)
    /\ UNCHANGED <<input, observedIdle, connected, frozen, reservation, ticket, heldTicket,
                   replyTicket, replyBinding, proofTicket, binding, up, closing>>

Next == RemoteInput \/ LocalInput \/ Deliver \/ Start \/ SettleOrReject \/ Observe
        \/ Reserve \/ Agree \/ ReceiveAgreement \/ Invalidate \/ Release \/ Disconnect
        \/ Reconnect \/ CancelClose \/ Crash \/ Restart \/ Commit
TypeOK ==
    /\ input \in {"none", "accepted", "preparing", "active"}
    /\ observedIdle \in BOOLEAN /\ connected \in BOOLEAN /\ frozen \in BOOLEAN
    /\ reservation \in BOOLEAN /\ ticket \in 0..2 /\ heldTicket \in 0..2
    /\ replyTicket \in 0..2 /\ replyBinding \in 0..2 /\ proofTicket \in 0..2 /\ binding \in 0..2
    /\ up \in BOOLEAN /\ closing \in BOOLEAN /\ departed \in BOOLEAN /\ unsafe \in BOOLEAN
NoUnsafeDeparture == ~unsafe
Spec == Init /\ [][Next]_vars
====
