// behaviors: how den-kit's ready-made controls respond to input, without any
// look. Each behavior takes input as plain values (pointer positions, wheel
// notches, keys) and sends values and events: `begin` when a gesture starts,
// `value` for each new value, `end` when it ends. One gesture is one undo step.
// The controls on the plugin screen are built on these, and code parts use the
// same behaviors through the kit. Imports nothing.
//
// The rules (decided 2026-10-24; test/unit/behaviors checks each):
//  1. A knob turns by dragging up and down. Its sensitivity is the same wherever
//     it is grabbed: 200 px of travel is its whole range. Holding Shift makes it
//     ten times finer.
//  2. Double-clicking a knob or a slider returns it to its default value.
//  3. One wheel notch moves a knob or a slider by 1% of its range; with Shift,
//     by 0.1%.
//  4. The keyboard follows WAI-ARIA's slider: the arrow keys move by 1% of the
//     range, Shift with an arrow and Page Up / Page Down by 10%, Home and End go
//     to the minimum and the maximum.
//  5. A slider moves from where it is grabbed, by as much as the pointer moves
//     along it; clicking it never makes the value jump.
//  6. A button is on only while it is pressed (momentary); a switch changes each
//     time it is pressed. Space and Enter press both.
//  7. An XY pad jumps to where it is clicked and follows the pointer; the arrow
//     keys move x (left, right) and y (up, down).
//  8. On the musical keyboard, the computer keys play notes: A is C, W and E are
//     the black keys above it, and so on along the row; Z and X move an octave
//     down and up. Dragging across the keys with the mouse plays each key it
//     reaches. Where a key is clicked, from top to bottom, sets how hard the note
//     is played.
//  9. A scope and a meter only show; they take no input. A meter holds its peak
//     for a moment.
// 10. Every control sends begin, value and end; one drag is one undo step.
export * from './range.ts';
export * from './events.ts';
export * from './knob.ts';
export * from './slider.ts';
export * from './button.ts';
export * from './xy.ts';
export * from './keyboard.ts';
export * from './meter.ts';
