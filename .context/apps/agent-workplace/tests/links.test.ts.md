## file

Transcript links open through the main process. Web links use `shell.openExternal` because transcript text is untrusted. File links use `shell.openPath`, and a file that could run is shown in Finder with `shell.showItemInFolder`. A line suffix is dropped only when the path with it is not a file.
Why: keeping a real `:12` suffix that is part of a filename would open the wrong path.
