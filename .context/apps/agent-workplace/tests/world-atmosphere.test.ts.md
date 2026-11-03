## file

Outdoor light follows local time. The page clock uses `setSystemTime` because `setFixedTime` would stop Phaser tweens that time by `Date.now()`. Golden hour leaves paintings and sprites as painted. Night lights windows and brightens lamps, but a lit window must not show through the avatar's chest. Indoors has no clock tint. Motion moves with life and stays drawn but still without it. Every effect of a place together takes a small part of a frame. `AGENT_WORLD_SHOTS` saves `aw-alive-11-*.png`.
Why: freezing `Date.now()` would make the light test pass while stopping the motion it is also checking.
