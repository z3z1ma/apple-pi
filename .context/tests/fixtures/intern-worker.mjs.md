## file

SIGTERM kills a detached child process group before the fixture exits.
Why: Pi print mode cleans up tools detached into their own process groups; the fixture must not leave those children running.
