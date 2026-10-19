## symbol:TownScene

Glow sprites are kept in `this.glows`, never `this.lights`.
Why: `lights` is Phaser's lights plugin on every scene; assigning an array there threw `this.lights.push is not a function` during `create`.
