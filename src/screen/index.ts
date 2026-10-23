// screen: the plugin screen, drawn in the work's own look. It builds the
// ready-made controls on behaviors, places code parts in frames from the host's
// sandbox and talks to them only through the kit, and checks the screen the way
// a designer would (overlaps, contrast, text too small). Moving a control is an
// operation on the work. screen imports behaviors and work only, so the player
// runs it outside the editor.
export {};
