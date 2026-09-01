# Review smell baseline

Apply these after the repository's documented standards. Repository conventions win, and automated formatter or linter findings are not review findings. Every smell is a labelled judgment call, not a hard violation. Report it only when the changed code creates a concrete maintenance or correctness cost.

Each smell reads *what it is* → *how to fix it*:

- **Mysterious Name**: a function, variable, or type whose name does not reveal what it does or holds. → Rename it; if no honest name comes, the design is murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → Extract the shared shape and call it from both when it represents one responsibility.
- **Feature Envy**: a method that reaches into another object's data more than its own. → Move the method onto the data it envies.
- **Data Clumps**: the same few fields or parameters keep travelling together—a type wanting to be born. → Bundle them into one type and pass that.
- **Primitive Obsession**: a primitive or string stands in for a domain concept that deserves its own type. → Give the concept its own small type.
- **Repeated Switches**: the same `switch` or `if` cascade on the same type recurs across the change. → Replace it with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → Gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → Split it so each module changes for one reason.
- **Speculative Generality**: an abstraction, parameter, or hook was added for needs the specification does not have. → Delete it; inline back until a real need appears.
- **Message Chains**: long `a.b().c().d()` navigation exposes collaborators the caller should not depend on. → Hide the walk behind one method on the first owner.
- **Middle Man**: a class or function mostly delegates onward. → Cut it and call the real target directly when no integration boundary needs the layer.
- **Refused Bequest**: a subclass or implementer ignores or overrides most of what it inherits. → Drop the inheritance and use composition or a smaller contract.
