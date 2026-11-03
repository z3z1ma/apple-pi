## file

A waypoint stays when skipping it would pass closer to furniture than the path allows. A 2-tile gap is crossed through its middle, a body's width from both sides. A 1-tile gap has 0.5 clearance at its middle. The nearest open cell to a click on a table is just above the table, by the click's column. Painted places have a path from every entry and door to every door and the place beside every spot, and no run between two corners is a one-cell sidestep. Path finding stays well under the time a click can take before it feels late.
Why: a shortcut through furniture or a late click path would fail the operator's walk.
