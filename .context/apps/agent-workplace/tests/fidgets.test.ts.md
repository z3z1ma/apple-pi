## file

Fidgets use the built world UI wired to the real backend the way the Electron preload wires it. Playing with a fidget, from the click or the menu, and Examine, sends the runtime no command, writes nothing, calls no place integration, and fetches nothing. A fidget is presentation only. Opening the world is set aside before counting fidget actions.
Why: a presentation object that reached the runtime would look like a person action.
