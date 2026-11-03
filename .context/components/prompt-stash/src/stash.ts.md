## file

The stash is an in-memory stack with a fixed bound. A push past that bound evicts the oldest prompt.
Why: the returned list is a copy. Changing it must not change the stored stack.
