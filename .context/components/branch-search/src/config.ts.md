## file

Configuration is read from the Pi agent directory, then from `.pi/` in a trusted project. Project values replace user values key by key. Arrays replace whole.
Why: protected paths are stored in one spelling, so `./a//b/` and `a/b` are the same path for git exclusions and overlap checks.
