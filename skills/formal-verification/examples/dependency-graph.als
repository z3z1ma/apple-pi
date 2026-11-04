sig Person {}

sig Task {
	dependsOn: set Task,
	owner: lone Person
}

fact NoSelfDependency { no t: Task | t in t.dependsOn }

assert NoCycles { no t: Task | t in t.^dependsOn }
check NoCycles for 4

run Chain { some t: Task | some t.dependsOn.dependsOn } for 3
