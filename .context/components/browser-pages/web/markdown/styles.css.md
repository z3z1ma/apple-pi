## file

A wide table scrolls on `.blk-content`, never on `.blk`.
Why: `.blk` also holds the absolutely positioned comment gutter (`.gut`); overflow on `.blk` clips it. After a change here, check in the browser that a wide table scrolls and that its gutter still shows.
