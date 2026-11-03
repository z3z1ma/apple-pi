## symbol:getActiveWorkSurface

One active-work surface exists for a Pi runtime.
Why: Pi gives each extension its own API object and event facade over a shared bus. The first installer answers a synchronous owner request on that bus. Later installers join its surface. The answering subscription belongs to the installer's runtime and ends with it, so a reloaded runtime creates a fresh owner.
