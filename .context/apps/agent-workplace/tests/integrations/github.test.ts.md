## file

The forge uses the backend API against a fake `gh` on PATH. The default branch is not a pull request and is not looked up. A declined confirmation, a made-up token, or another write's token sends nothing. A token is good once.
Why: reusing a confirmation token would let one approval authorize a later write.
