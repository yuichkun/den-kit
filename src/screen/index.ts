// screen: the plugin screen, drawn in the work's own look. It builds the
// ready-made controls on behaviors, shows code parts in sandboxed frames and
// talks to them only through the kit (which carries the behaviors too), and
// checks the screen the way a designer would (overlaps, contrast, text too
// small). A moved control is reported to the entry that shows the screen: the
// editor makes it an operation on the work, the player only plays it. screen
// imports behaviors and work only, so the player runs it outside the editor.
export {};
