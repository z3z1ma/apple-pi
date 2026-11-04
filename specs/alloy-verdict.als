module alloyVerdict

abstract sig Kind {}
one sig Check, Run extends Kind {}

abstract sig Expect {}
one sig ExpectInstance, ExpectNone extends Expect {}

abstract sig Outcome {}
one sig Counterexample, NoCounterexample, Instance, NoInstance, NotRun extends Outcome {}

sig Command {
	kind: one Kind,
	expected: lone Expect,
	outcome: one Outcome
}

fact OutcomesFitKinds {
	all c: Command | c.kind = Check implies c.outcome in Counterexample + NoCounterexample + NotRun
	all c: Command | c.kind = Run implies c.outcome in Instance + NoInstance + NotRun
}

pred found[c: Command] { c.outcome in Counterexample + Instance }

fun ran: set Command { { c: Command | c.outcome != NotRun } }

fun missed: set Command {
	{ c: ran | some c.expected and (found[c] iff c.expected = ExpectNone) }
}

fun properties: set Command { { c: ran | c.kind = Check and c.expected != ExpectInstance } }

fun refuted: set Command { { c: properties | c.outcome = Counterexample and no c.expected } }

fun empty: set Command { { c: ran | c.kind = Run and no c.expected and not found[c] } }

pred witness { some c: ran | c.kind = Run and c.expected != ExpectNone and found[c] }

pred violation { some refuted or some missed }

pred incomplete {
	not violation
	(some c: Command | c.outcome = NotRun) or some empty or no properties or not witness
}

pred pass { not violation and not incomplete }

assert PassProvesEveryProperty {
	pass implies all c: Command | c.kind = Check and c.expected != ExpectInstance implies c.outcome = NoCounterexample
}
check PassProvesEveryProperty for 6

assert PassMeetsEveryExpect {
	pass implies all c: Command | some c.expected implies (found[c] iff c.expected = ExpectInstance)
}
check PassMeetsEveryExpect for 6

assert PassHasSatisfiableFacts { pass implies witness }
check PassHasSatisfiableFacts for 6

assert ControlsAloneNeverPass {
	(all c: Command | c.kind = Check implies c.expected = ExpectInstance) implies not pass
}
check ControlsAloneNeverPass for 6

assert UnrunCommandsNeverPass { (some c: Command | c.outcome = NotRun) implies not pass }
check UnrunCommandsNeverPass for 6

assert EveryRunFindsAnInstance { pass implies all c: Command | c.kind = Run implies found[c] }
check EveryRunFindsAnInstance for 4 expect 1

run PassIsReachable { pass } for 4
run ControlWithPropertyPasses {
	pass
	some c: Command | c.kind = Check and c.expected = ExpectInstance
} for 4
