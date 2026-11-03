## file

Restore the built-in footer even if restoring the editor API fails.
Why: these are independent UI surfaces; one unavailable API must not strand the other replacement.
