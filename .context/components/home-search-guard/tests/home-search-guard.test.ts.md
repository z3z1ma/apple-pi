## file

The accepted-command fixtures include nested command substitution and wrapper commands.
Why: the search guard does not parse nested substitutions or unwrap sudo, env, nice and timeout. These fixtures preserve that limited-parser boundary rather than claiming shell-wide protection.
