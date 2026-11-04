module leanTrust

-- lean_check's trust boundary (components/formal-verification/src/lean.ts).
-- The checked file becomes module ApplePiChecked in a scratch directory.
-- Every imported module's .olean lies somewhere: in the toolchain's library,
-- under the project's .lake/packages (Lake dependencies such as Mathlib), in
-- the project itself, or elsewhere (for example a Lake path dependency, which
-- Lake builds inside its own directory). leanchecker replays some modules
-- through the kernel; the toolchain and Lake packages are trusted by design.
-- Claim: every declaration an audited theorem depends on is either
-- kernel-replayed or trusted by design.

abstract sig Location {}
one sig Scratch, Toolchain, Packages, Project, Elsewhere extends Location {}

sig Module {
	location: one Location,
	imports: set Module
}

one sig Checked extends Module {}

sig Decl {
	owner: one Module,
	uses: set Decl
}

sig Audited in Decl {}

fact Modules {
	Checked.location = Scratch
	all m: Module - Checked | m.location != Scratch
	no m: Module | m in m.^imports
	no m: Module | Checked in m.imports
	all m: Module - Checked | m in Checked.^imports
}

fact Declarations {
	all d: Decl, u: d.uses | u.owner in d.owner + d.owner.^imports
	no d: Decl | d in d.^uses
	Audited.owner = Checked
	some Audited
}

-- runLean before this model: the checked module and imports whose .olean lies
-- inside the project root and outside .lake/packages.
pred replayedBefore[m: Module] { m = Checked or m.location = Project }

-- runLean now: every module that is not trusted by design.
pred replayed[m: Module] { m.location not in Toolchain + Packages }

pred trusted[m: Module] { m.location in Toolchain + Packages }

assert BeforeCoversEveryDependency {
	all t: Audited, d: t.*uses | replayedBefore[d.owner] or trusted[d.owner]
}
check BeforeCoversEveryDependency for 5 expect 1

assert EveryDependencyIsReplayedOrTrusted {
	all t: Audited, d: t.*uses | replayed[d.owner] or trusted[d.owner]
}
check EveryDependencyIsReplayedOrTrusted for 6

assert ReplayNeverIncludesTrustedModules {
	all m: Module | replayed[m] implies not trusted[m]
}
check ReplayNeverIncludesTrustedModules for 6

run ProjectWithPathDependency {
	some d: Audited.^uses | d.owner.location = Elsewhere
	some d: Audited.^uses | d.owner.location = Packages
} for 5
