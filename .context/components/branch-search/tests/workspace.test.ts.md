## file

A read-only directory makes `git apply` fail after it has written the writable files.
Why: the test then changes files the patch did not own, so a partial apply cannot be mistaken for a clean winner.
