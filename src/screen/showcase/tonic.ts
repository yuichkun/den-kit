// Tonic — a tanpura-style drone to sing or practise over.
// One string is a part (String): a slow square wave, offset by the copy's
// number, plucks it once per cycle; a saw rings through a warm lowpass and a
// narrow band that slides down from high overtones to the note as the pluck
// dies (the buzz of the bridge, "jawari"). The part runs ×4 and its Interval
// gives each copy its own string by an `each` spread: the lower fifth (Pa), two
// at the tonic (Sa) and one an octave below, plucked in turn. Splay spreads
// the four strings and a hall holds them.
// The design follows the thinking of NaadSadhana (Apple Design Awards 2021,
// Innovation), a practice companion for singers whose backing is made to match
// the singer: here the drone is tuned to the singer's tonic by touching it on
// the ring, and every other note is named by its distance from Sa. The plugin
// is the whole tanpura, lying on its side: the gourd carries the ring, its four
// strings run along the neck to their pegs and shake in time with the plucks
// heard, the bridge pales up as the drone gets louder (it is the plugin's meter),
// and over the neck a practice staff writes each pluck on its note as it is
// heard. Jawari, the pace and the hall are set on the drawing itself (the thread
// on the strings, the staff, the room round the gourd), the setting written by
// the hand, and the tonic stands in the corner as a singer asks for it. The
// work's name is written on the gourd over the strings, as a maker signs one.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The letter names round the gourd, C just right of the top (the ring is turned half a step; see the canvas), written in plain letters so every name is in one font. */
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
/** The tanpura lying across the plugin, over its neck the practice staff of the plucks, and in the corner the tonic: the gourd is the ring of notes, the four strings run from its bridge along the neck to the pegs; it takes the mouse. */
export const TONIC_CIRCLE = `// The tanpura, lying on its side. The gourd, on the left, carries a ring of the
// twelve notes (their letter names are text on the plugin, round the gourd); Sa
// sits on the tonic (ksa, a MIDI note) and every other note is named from it, Pa
// joined to it by a bow along the ring. The ring is turned half a step so that
// the neck leaves the gourd between two notes. The four strings (Pa, Sa, Sa, Sa
// below; the low ones thicker) run from the bridge on the gourd along the neck,
// over the nut, to their pegs. A pluck is heard as a jump in the output level:
// the next string in turn shakes and dies away; between the bridge and the
// thread (Jawari, kjaw) it buzzes. The bridge is the drone's meter, laid over
// the canvas: the louder it sounds, the higher the bone pales up it.
// Over the neck is the practice staff, a line for each note the strings play
// (Sa; Pa and Sa below, dotted under): each pluck is written on its note's line
// as it is heard and drifts left as it rings, thinning as it dies, and the next
// plucks wait to the right of the now line, as far apart as the pace sets them
// (kbpm, plucks a minute). Each pluck also spreads a ring into the room round
// the gourd, as far as the hall reaches (kspace); the room's rings are as many
// as the hall holds and spread as far out as it reaches. In the corner is the
// tonic as a singer asks for it: its note and octave, and its pitch, in the
// same type as the names on the ring.
// Press a note to make it Sa; drag the thread along the strings for Jawari, the
// staff across for the pace (the plucks waiting spread out or close up with the
// hand), the room in or out for the hall, and the tonic up or down a semitone at
// a time (it reaches the ends of its range, which the ring does not). The
// setting under the hand is written by it (the hall on the bare ground just
// outside the room, out from its middle through the hand).
const CX = 262, CY = 260, DISC = 148, R = 130, SW = R - 26;
const BX = CX - 72, NUT = 628, END = 720; // the bridge, the nut, the end of the neck
const YS = [-15, -5, 5, 15], YN = [-8, -2.7, 2.7, 8]; // the strings at the bridge and at the nut, in the order they are plucked
const PEGS = [648, 692, 714, 670], PEG_SIDE = [-1, -1, 1, 1]; // each string's peg, and on which side: the outer strings to the nearer pegs, so none cross
const LOW = [true, false, false, true]; // Pa and the last Sa are an octave down
const THREAD = 64;
const NAMES = ${JSON.stringify(NOTE_NAMES)};
const SWARA = ['Sa', 're', 'Re', 'ga', 'Ga', 'ma', "Ma'", 'Pa', 'dha', 'Dha', 'ni', 'Ni'];
const TAU = Math.PI * 2;
// The practice staff: its lines (Sa, then Pa and Sa below, 8 px a semitone), the now line, and how fast the
// plucks drift left (px a second).
export const STAFF = { x0: 480, x1: 736, lines: 516, now: 660, top: 36, bot: 180, sa: 60, speed: 32 };
const LINE_OF = [STAFF.sa + 5 * 8, STAFF.sa, STAFF.sa, STAFF.sa + 12 * 8]; // each string's line, in the order they are plucked
// The room round the gourd: its first ring, and how far its rings reach out at a full hall.
const ROOM = DISC + 36, REACH = 42;
const EDGE_AT = (150 / 360) * TAU; // the way out from the room's middle along which the hall is written while the hand is off the canvas
/** A point on the room's outermost ring (lower left), for a hall: the room is dragged in or out anywhere on it. */
export const roomEdge = space => {
  const r = ROOM + Math.max(0, Math.min(1, space)) * REACH;
  return { x: CX + Math.cos(EDGE_AT) * r, y: CY + Math.sin(EDGE_AT) * r };
};
// The tonic in the corner: its right edge, and the box that takes the mouse.
export const TONIC = { x: 736, left: 548, top: 352, bot: 500 };
// A note's place on the ring: half a step round from the top, so none sits where the neck leaves.
const at = (pc, r) => {
  const a = ((pc + 0.5) / 12) * TAU - Math.PI / 2;
  return [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
};
const noteAt = (x, y) => ((Math.floor(((Math.atan2(y - CY, x - CX) + Math.PI / 2) / TAU) * 12) % 12) + 12) % 12;
// The neck's half-width at x: it narrows from the gourd to the nut; the pegbox past the nut.
const neckHalf = x => (x < NUT ? 26 - (4 * (x - (CX + DISC - 12))) / (NUT - CX - DISC + 12) : 22 - (5 * (x - NUT)) / (END - NUT));
// Where a string meets its peg: at the pegbox's edge, by the peg's stem.
const tie = i => CY + PEG_SIDE[i] * (neckHalf(PEGS[i]) - 3);
// A string's height at x (before it shakes): straight from the bridge to the nut, then to its peg.
function stringY(i, x) {
  if (x <= NUT) return CY + YS[i] + ((YN[i] - YS[i]) * (x - BX)) / (NUT - BX);
  return CY + YN[i] + (tie(i) - CY - YN[i]) * Math.min(1, (x - NUT) / (PEGS[i] - NUT));
}
const threadX = jaw => BX + 10 + (Math.max(0, Math.min(6, jaw)) / 6) * THREAD;
// The parts you take hold of: the thread, the staff, the tonic, the ring of notes, the room round the gourd.
export function zone(x, y, jaw) {
  const d = Math.hypot(x - CX, y - CY);
  if (x > BX - 12 && x < NUT && Math.abs(y - CY) < 26 && Math.abs(x - threadX(jaw)) < 12) return 'jaw';
  if (x >= STAFF.x0 - 8 && x <= STAFF.x1 + 8 && y >= STAFF.top && y <= STAFF.bot) return 'pace';
  if (x >= TONIC.left && x <= TONIC.x + 8 && y >= TONIC.top && y <= TONIC.bot) return 'tonic';
  if (d > R - 20 && d < R + 22) return 'ring';
  if (d >= DISC + 18 && d <= ROOM + REACH + 24 && !(x > CX && Math.abs(y - CY) < 40) && !(x >= STAFF.x0 - 8 && y <= STAFF.bot)) return 'hall';
  return null;
}
const CURSOR = { pace: 'ew-resize', hall: 'move', ring: 'pointer', jaw: 'ew-resize', tonic: 'ns-resize' };
// How dark the room is tinted under the hand.
const TINT = 0.14;
// The setting under the hand, written by it in one colour, cut out of what is behind it (the other).
function say(ctx, text, x, y, w, ink, behind) {
  ctx.font = '700 14px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const m = ctx.measureText(text), tw = typeof m.width === 'number' ? m.width : text.length * 7.8;
  const x0 = Math.round(Math.max(8, Math.min(w - tw - 8, x - tw / 2))), y0 = Math.round(y) + 0.5;
  ctx.strokeStyle = behind; ctx.lineWidth = 5; ctx.strokeText(text, x0, y0);
  ctx.fillStyle = ink; ctx.fillText(text, x0, y0);
}
// Where the hall is written: on the bare ground just outside the room's tint (edge, its radius), out from the
// room's middle through the hand (through the lower left while the hand is off the canvas); turned round the room
// a step at a time where that is on the neck, the staff, the tonic or past the canvas's edge.
export function hallAt(edge, tw, w, h, hand) {
  const a0 = hand ? Math.atan2(hand.y - CY, hand.x - CX) : EDGE_AT;
  const spot = a => {
    const c = Math.cos(a), sn = Math.sin(a), d = edge + 8 + (Math.abs(c) * tw) / 2 + Math.abs(sn) * 9;
    return { x: CX + c * d, y: CY + sn * d };
  };
  const clear = ({ x, y }) => {
    const x0 = x - tw / 2, x1 = x + tw / 2, y0 = y - 9, y1 = y + 9;
    return x0 >= 8 && x1 <= w - 8 && y0 >= 8 && y1 <= h - 8 &&
      !(x1 > CX + DISC - 30 && y1 > CY - 48 && y0 < CY + 48) &&
      !(x1 > STAFF.x0 - 12 && y0 < STAFF.bot + 8) &&
      !(x1 > TONIC.left - 8 && y1 > TONIC.top - 8);
  };
  for (let k = 0; k <= 36; k++) {
    const at = spot(a0 + Math.ceil(k / 2) * (k % 2 ? 1 : -1) * (TAU / 72));
    if (clear(at)) return at;
  }
  return spot(a0);
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { prev: 0, last: -10, string: 3, amp: [0, 0, 0, 0], rings: [], plucks: [], drag: null });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h;
    const field = f.color('bg'), wine = f.color('accent'), bone = '#fff1d6', wood = '#5a0c1c';
    const sa = ((Math.round(f.value('ksa')) % 12) + 12) % 12, pa = (sa + 7) % 12;
    const jaw = f.value('kjaw'), hall = f.value('kspace'), bpm = f.value('kbpm');
    ctx.clearRect(0, 0, w, h);
    // A pluck: the output jumps up; the next string in turn shakes.
    const gap = 60 / Math.max(20, bpm);
    if (f.level > s.prev * 1.12 + 0.002 && f.t - s.last > gap * 0.55) {
      s.last = f.t;
      s.string = (s.string + 1) % 4;
      s.amp[s.string] = 1;
      s.rings.push(f.t);
      s.plucks.push({ t: f.t, i: s.string });
    }
    s.prev = s.prev * 0.9 + f.level * 0.1;
    for (let i = 0; i < 4; i++) s.amp[i] *= Math.exp(-f.dt / 1.4);
    s.rings = s.rings.filter(t0 => f.t - t0 < 3);
    s.plucks = s.plucks.filter(q => f.t - q.t < (STAFF.now - STAFF.lines + 20) / STAFF.speed);
    const p = f.pointer, under = s.drag || (p && p.over ? zone(p.x, p.y, jaw) : null);
    // The room round the gourd: its rings, thin and apart, more of them and further out the more the hall holds
    // (under the hand, darker and thicker, and the room tinted out to them); each pluck sends one out.
    const reach = ROOM + hall * REACH;
    if (under === 'hall') {
      ctx.fillStyle = wine; ctx.globalAlpha = TINT;
      ctx.beginPath(); ctx.arc(CX, CY, reach + 8, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = wine;
    const rings = Math.max(1, Math.round(hall * 6));
    for (let i = 1; i <= rings; i++) {
      ctx.lineWidth = under === 'hall' ? 2.5 : 1.25;
      ctx.globalAlpha = (under === 'hall' ? 1 : 0.75) * (1 - i / 8);
      ctx.beginPath(); ctx.arc(CX, CY, ROOM + ((reach - ROOM) * i) / rings, 0, TAU); ctx.stroke();
    }
    for (const t0 of s.rings) {
      const age = (f.t - t0) / 3;
      ctx.globalAlpha = (1 - age) * (0.25 + 0.6 * hall);
      ctx.lineWidth = 1.25 * (1 - age) + 0.5;
      ctx.beginPath(); ctx.arc(CX, CY, ROOM + age * REACH * hall, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // The practice staff: a line for each note the strings play, the plucks written on them as they are heard,
    // drifting left as they ring; the next ones waiting right of the now line.
    ctx.font = '700 14px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    [[STAFF.sa, 'Sa', false], [LINE_OF[0], 'Pa', true], [LINE_OF[3], 'Sa', true]].forEach(([y, name, low]) => {
      ctx.fillStyle = wine; ctx.fillText(name, STAFF.x0, y + 1);
      if (low) { ctx.beginPath(); ctx.arc(STAFF.x0 + 9, y + 13, 2, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = under === 'pace' ? 0.7 : 0.4; ctx.fillRect(STAFF.lines, Math.round(y) - 0.75, STAFF.x1 - STAFF.lines, 1.5); ctx.globalAlpha = 1;
    });
    ctx.fillStyle = wine;
    ctx.fillRect(STAFF.now - 1, STAFF.top + 4, 2, STAFF.bot - STAFF.top - 8);
    const xAt = t => STAFF.now + (t - f.t) * STAFF.speed;
    ctx.save();
    ctx.beginPath(); ctx.rect(STAFF.lines, STAFF.top, STAFF.x1 - STAFF.lines, STAFF.bot - STAFF.top); ctx.clip();
    for (const q of s.plucks) {
      const x = xAt(q.t), y = LINE_OF[q.i], age = f.t - q.t, th = (k => 7 * Math.exp(-k / 1.4));
      // Its ring, from the pluck to now, thinning as it dies.
      ctx.beginPath();
      ctx.moveTo(x, y - th(0) / 2);
      for (let k = 0; k <= 8; k++) { const u = (k / 8) * age; ctx.lineTo(xAt(q.t + u), y - th(u) / 2); }
      for (let k = 8; k >= 0; k--) { const u = (k / 8) * age; ctx.lineTo(xAt(q.t + u), y + th(u) / 2); }
      ctx.closePath(); ctx.fillStyle = wine; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.roundRect(x - 7, y - 5, 14, 10, 5); ctx.fillStyle = wine; ctx.fill();
    }
    // The next plucks, as the pace sets them, coming in whole from the staff's right end.
    for (let k = 1; k <= 3; k++) {
      const t = Math.max(s.last, f.t - gap) + k * gap, i = (s.string + k) % 4, x = xAt(t), y = LINE_OF[i];
      if (x < STAFF.now + 4 || x > STAFF.x1 - 9) continue;
      ctx.globalAlpha = Math.min(1, (STAFF.x1 - 9 - x) / 24);
      ctx.beginPath(); ctx.roundRect(x - 7, y - 5, 14, 10, 5);
      ctx.lineWidth = under === 'pace' && k === 1 ? 2.5 : 1.5; ctx.strokeStyle = wine; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // The neck, behind the gourd: dark wood with a bone inlay along each side; past the nut, the pegbox and its pegs.
    const neck = () => {
      ctx.beginPath();
      ctx.moveTo(CX + DISC - 30, CY - neckHalf(CX + DISC - 12));
      for (let x = CX + DISC - 12; x <= END; x += 4) ctx.lineTo(x, CY - neckHalf(x));
      ctx.quadraticCurveTo(END + 10, CY, END, CY + neckHalf(END));
      for (let x = END; x >= CX + DISC - 12; x -= 4) ctx.lineTo(x, CY + neckHalf(x));
      ctx.lineTo(CX + DISC - 30, CY + neckHalf(CX + DISC - 12));
      ctx.closePath();
    };
    for (let i = 0; i < 4; i++) {
      // A peg: a turned stem out of the pegbox and a flat bone head to turn it by.
      const x = PEGS[i], side = PEG_SIDE[i], y0 = CY + side * (neckHalf(x) - 2);
      ctx.fillStyle = wood; ctx.fillRect(x - 3.5, side < 0 ? y0 - 12 : y0, 7, 12);
      ctx.fillStyle = bone;
      ctx.beginPath(); ctx.roundRect(x - 8, side < 0 ? y0 - 30 : y0 + 12, 16, 18, 6); ctx.fill();
    }
    neck(); ctx.fillStyle = wood; ctx.fill();
    ctx.strokeStyle = bone; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let x = CX + DISC; x <= NUT - 8; x += 4) { const y = CY + side * (neckHalf(x) - 6); if (x === CX + DISC) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = bone; ctx.fillRect(NUT - 3, CY - neckHalf(NUT) + 3, 6, (neckHalf(NUT) - 3) * 2);
    // The gourd, and the ring of notes on it.
    ctx.fillStyle = wine;
    ctx.beginPath(); ctx.arc(CX, CY, DISC, 0, TAU); ctx.fill();
    ctx.strokeStyle = field;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, TAU); ctx.stroke();
    // Sa to Pa, the drone's fifth: a bow along the ring, seven notes round.
    const a0 = ((sa + 0.5) / 12) * TAU - Math.PI / 2;
    ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(CX, CY, R, a0, a0 + (7 / 12) * TAU); ctx.stroke();
    ctx.lineCap = 'butt';
    // Every note named from Sa.
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const hover = p && p.over && !s.drag && under === 'ring' ? noteAt(p.x, p.y) : -1;
    for (let pc = 0; pc < 12; pc++) {
      const step = (pc - sa + 12) % 12;
      const [x, y] = at(pc, R);
      if (pc === sa) {
        ctx.fillStyle = field;
        ctx.beginPath(); ctx.arc(x, y, 19, 0, TAU); ctx.fill();
        ctx.fillStyle = wine;
        ctx.fillText('Sa', x, y + 1);
        continue;
      }
      if (pc === pa) {
        ctx.fillStyle = wine;
        ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.fill();
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = field;
        ctx.fillText('Pa', x, y + 1);
        continue;
      }
      ctx.fillStyle = field;
      ctx.beginPath(); ctx.arc(x, y, pc === hover ? 7 : 4, 0, TAU); ctx.fill();
      const [lx, ly] = at(pc, SW);
      ctx.globalAlpha = pc === hover ? 1 : 0.85;
      ctx.fillText(SWARA[step], lx, ly + 1);
      ctx.globalAlpha = 1;
    }
    // The four strings shaking, from the bridge to their pegs; between the bridge and the thread they buzz.
    const tx = threadX(jaw);
    for (let i = 0; i < 4; i++) {
      const a = s.amp[i], lit = i === s.string ? Math.max(0, 1 - (f.t - s.last) / 1.2) : 0;
      ctx.strokeStyle = bone;
      ctx.lineWidth = LOW[i] ? 2.6 : 1.7;
      ctx.globalAlpha = 0.72 + 0.28 * lit;
      ctx.beginPath();
      ctx.moveTo(BX, stringY(i, BX));
      for (let x = BX + 3; x <= NUT; x += 3) {
        const u = (x - BX) / (NUT - BX);
        let dy = a * 4 * Math.sin(Math.PI * u) * Math.sin(f.t * 47 + i * 1.7);
        // The buzz: rough, strongest at the bridge and gone by the thread.
        if (x < tx) dy += a * (0.6 + jaw * 0.6) * (1 - (x - BX) / Math.max(1, tx - BX)) * Math.sin(x * 2.3 + f.t * 91 + i * 2.1) * Math.sin(x * 0.61 - f.t * 37);
        ctx.lineTo(x, stringY(i, x) + dy);
      }
      ctx.lineTo(PEGS[i], tie(i));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // The thread: drag it along the strings, away from the bridge, for more buzz. A cotton thread laid under the
    // strings, its loose ends curling away.
    const hot = under === 'jaw', treach = 15 - (7 * (tx - BX)) / (NUT - BX) + 7;
    ctx.strokeStyle = field; ctx.lineWidth = hot ? 3 : 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tx + 7, CY - treach - 7);
    ctx.quadraticCurveTo(tx, CY - treach - 3, tx, CY - treach + 3);
    ctx.lineTo(tx, CY + treach - 3);
    ctx.quadraticCurveTo(tx, CY + treach + 3, tx - 7, CY + treach + 7);
    ctx.stroke(); ctx.lineCap = 'butt';
    // The tonic, as a singer asks for it: the note and its octave, and its pitch.
    const midi = Math.round(f.value('ksa')), hz = 440 * Math.pow(2, (midi - 69) / 12);
    ctx.fillStyle = wine; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    const note = NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
    ctx.font = '700 32px system-ui, sans-serif';
    ctx.fillText(note, TONIC.x, TONIC.bot - 34);
    const nm = ctx.measureText(note), nw = typeof nm.width === 'number' ? nm.width : note.length * 20;
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.fillText('Sa  ' + hz.toFixed(1) + ' Hz', TONIC.x, TONIC.bot - 12);
    if (under === 'tonic') {
      // Up or down a semitone: a wedge each way, by the note.
      const wx = TONIC.x - nw - 16, wy = TONIC.bot - 44;
      ctx.beginPath(); ctx.moveTo(wx - 7, wy - 10); ctx.lineTo(wx + 7, wy - 10); ctx.lineTo(wx, wy - 20); ctx.closePath();
      ctx.moveTo(wx - 7, wy + 4); ctx.lineTo(wx + 7, wy + 4); ctx.lineTo(wx, wy + 14); ctx.closePath(); ctx.fill();
    }
    // The setting under the hand, written by it.
    if (under === 'jaw') say(ctx, 'Jawari ' + jaw.toFixed(1), tx, CY - 48, w, field, wine);
    else if (under === 'pace') say(ctx, Math.round(bpm) + ' plucks a minute', (STAFF.lines + STAFF.x1) / 2, STAFF.top - 12, w, wine, field);
    else if (under === 'hall') {
      const text = 'Hall ' + Math.round(hall * 100) + '%';
      ctx.font = '700 14px system-ui, sans-serif';
      const m = ctx.measureText(text), at = hallAt(reach + 8, typeof m.width === 'number' ? m.width : text.length * 7.8, w, h, p && p.over ? p : null);
      say(ctx, text, at.x, at.y, w, wine, field);
    }
  },
  pointer(e, f) {
    const s = f.state, z = zone(e.x, e.y, f.value('kjaw'));
    if (e.type === 'down') {
      s.drag = z;
      Object.assign(s, { x0: e.x, y0: e.y, d0: Math.hypot(e.x - CX, e.y - CY), v0: z === 'pace' ? 60 / f.value('kbpm') : z === 'hall' ? f.value('kspace') : z === 'tonic' ? Math.round(f.value('ksa')) : 0 });
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = null;
    if (e.type === 'wheel' && z === 'tonic') f.set('ksa', Math.max(45, Math.min(60, Math.round(f.value('ksa')) - Math.sign(e.dy))));
    if (e.type === 'wheel' && (z === 'pace' || z === 'hall' || z === 'jaw')) {
      const id = z === 'pace' ? 'kbpm' : z === 'hall' ? 'kspace' : 'kjaw', span = z === 'pace' ? 60 : z === 'hall' ? 1 : 6;
      const lo = z === 'pace' ? 30 : 0;
      f.set(id, Math.max(lo, Math.min(lo + span, f.value(id) - Math.sign(e.dy) * span * 0.01)));
    }
    if ((e.type === 'down' || e.type === 'move') && s.drag) {
      if (s.drag === 'ring') {
        f.set('ksa', 48 + noteAt(e.x, e.y));
      } else if (s.drag === 'jaw') {
        f.set('kjaw', Math.max(0, Math.min(6, ((e.x - BX - 10) / THREAD) * 6)));
      } else if (s.drag === 'pace' && e.type === 'move') {
        // The plucks waiting spread out with the hand, the second of them under it: half the hand's travel, at the
        // staff's speed, is added to the time between plucks.
        const gap = s.v0 + (e.x - s.x0) / (2 * STAFF.speed);
        f.set('kbpm', Math.max(30, Math.min(90, 60 / Math.max(0.1, gap))));
      } else if (s.drag === 'tonic' && e.type === 'move') {
        // Up or down, a semitone for every 12 px the hand travels.
        f.set('ksa', Math.max(45, Math.min(60, Math.round(s.v0 + (s.y0 - e.y) / 12))));
      } else if (s.drag === 'hall' && e.type === 'move') {
        // In or out from the gourd: the outermost ring follows the hand.
        f.set('kspace', Math.max(0, Math.min(1, s.v0 + (Math.hypot(e.x - CX, e.y - CY) - s.d0) / REACH)));
      }
    }
    f.cursor(s.drag ? CURSOR[s.drag] : z ? CURSOR[z] : 'default');
  },
};
`;

/** Where the canvas draws the ring (its CX, CY), and how far out the names stand. */
const CENTRE = { x: 262, y: 260 };
/** The bridge's top-left corner on the plugin (the canvas's BX − 7, CY − 26). */
const BRIDGE = { x: CENTRE.x - 79, y: CENTRE.y - 26 };
const NAME_R = 172;

export function tonic(catalog: Catalog) {
  const inside = [
    'idx1',
    'when1',
    'lfo1',
    'gate1',
    'env1',
    'note1',
    'wob1',
    'note2',
    'mtof1',
    'osc1',
    'bodyhz1',
    'body1',
    'jbase1',
    'jawamt1',
    'jawhz1',
    'buzz1',
    'mix1',
    'vca1',
  ];
  return workInSteps(
    'tonic',
    'Tonic',
    catalog,
    [760, 520],
    [
      [
        // ---- one string: plucked once a cycle, at its own beat ----
        add('idx1', 'kit.copy', { label: 'Which string' }),
        add('when1', 'kit.mul', { label: 'Its beat', values: { b: 0.25 } }),
        add('lfo1', 'den.musicalLfo', {
          label: 'Cycle',
          config: { mode: 'tempo', waveform: 'square', beatsPerCycle: '4' },
        }),
        add('gate1', 'kit.compare', { label: 'Pluck', values: { b: 0 } }),
        add('env1', 'den.envelope', {
          label: 'Ring',
          values: { attack: 0.003, decay: 3.5, sustain: 0, release: 3 },
        }),
        add('note1', 'kit.add', { label: 'Interval' }),
        add('wob1', 'kit.scale', { label: 'A little off', values: { scale: 0.08, offset: -0.04 } }),
        add('note2', 'kit.add', { label: 'Note' }),
        add('mtof1', 'kit.mtof'),
        add('osc1', 'den.oscillator', { label: 'String', config: { waveform: 'saw' } }),
        add('bodyhz1', 'kit.mul', { label: 'Body tone', values: { b: 5 } }),
        add('body1', 'den.stateVariableFilter', { label: 'Body', values: { q: 0.7 } }),
        add('jbase1', 'kit.mul', { label: 'Buzz base', values: { b: 2 } }),
        add('jawamt1', 'kit.mul', { label: 'Buzz sweep' }),
        add('jawhz1', 'kit.cutoffMod', { label: 'Buzz' }),
        add('buzz1', 'den.stateVariableFilter', { label: 'Bridge', values: { q: 6 } }),
        add('mix1', 'kit.mix', {
          label: 'Body + buzz',
          config: { channels: 2 },
          values: { level1: 0.7, level2: 1.6 },
        }),
        add('vca1', 'kit.mul', { label: 'String out' }),
        wire('idx1.index', 'when1.a'),
        wire('when1.out', 'lfo1.phaseOffset'),
        wire('lfo1.value', 'gate1.a'),
        wire('gate1.out', 'env1.gate'),
        wire('note1.out', 'note2.a'),
        wire('idx1.random', 'wob1.in'),
        wire('wob1.out', 'note2.b'),
        wire('note2.out', 'mtof1.note'),
        wire('mtof1.out', 'osc1.frequency'),
        wire('mtof1.out', 'bodyhz1.a'),
        wire('bodyhz1.out', 'body1.cutoffHz'),
        wire('osc1.out', 'body1.input'),
        wire('mtof1.out', 'jbase1.a'),
        wire('jbase1.out', 'jawhz1.hz'),
        wire('env1.level', 'jawamt1.a'),
        wire('jawamt1.out', 'jawhz1.octaves'),
        wire('jawhz1.out', 'buzz1.cutoffHz'),
        wire('osc1.out', 'buzz1.input'),
        wire('body1.lowpass', 'mix1.in1'),
        wire('buzz1.bandpass', 'mix1.in2'),
        wire('mix1.out', 'vca1.a'),
        wire('env1.level', 'vca1.b'),
        // ---- the drone: the tonic, the pace and the buzz come in; four strings across, a hall ----
        ...patchControl('ksa', 'Sa', 'note1.a', [45, 60, 'linear', 'note'], 48),
        add('splay1', 'kit.splay', { label: 'Across', values: { width: 0.7 } }),
        add('hall1', 'den.algorithmicReverb', {
          label: 'Hall',
          config: { roomScale: 1, decaySeconds: 3.4, dampingHz: 5500 },
          values: { mix: 0.3 },
        }),
        add('gl1', 'kit.gain', { label: 'Level L', values: { gain: 0.2 } }),
        add('gr1', 'kit.gain', { label: 'Level R', values: { gain: 0.2 } }),
        add('out1', 'kit.out'),
        wire('vca1.out', 'splay1.in'),
        wire('splay1.left', 'hall1.left'),
        wire('splay1.right', 'hall1.right'),
        wire('hall1.left', 'gl1.in'),
        wire('hall1.right', 'gr1.in'),
        wire('gl1.out', 'out1.left'),
        wire('gr1.out', 'out1.right'),
        ...patchControl('kbpm', 'Plucks a minute', 'lfo1.rate', [30, 90, 'linear', ''], 54),
        ...patchControl('kjaw', 'Jawari', 'jawamt1.b', [0, 6, 'linear', 'oct'], 4),
        ...patchControl('kspace', 'Hall', 'hall1.mix', [0, 1, 'linear', ''], 0.3),
        { op: 'makePart', ids: inside, name: 'String', id: 'string', node: 'string1' },
      ],
      // Its one knob: which string this copy is, in semitones from the tonic.
      doc =>
        onlyParams(doc, 'string', [
          {
            node: 'note1',
            port: 'b',
            id: 'interval',
            label: 'Interval',
            range: { min: -12, max: 12, unit: 'st' },
          },
        ]),
      [
        {
          op: 'updatePart',
          part: 'string',
          doc: 'One tanpura string: plucked once a cycle at its own beat (copy k of 4 on beat k), ringing through a warm body and a buzz that slides down as it dies. Interval is its note above the tonic.',
        },
        { op: 'setCount', node: 'string1', count: 4 },
        {
          op: 'setSpread',
          node: 'string1',
          port: 'interval',
          spread: { kind: 'each', values: [-5, 0, 0, -12] },
        },
        // ---- the plugin: the tanpura on its side, the gourd's ring of notes on the left ----
        {
          op: 'setLook',
          look: {
            tokens: {
              bg: '#f2b01e',
              fg: '#1c0b05',
              accent: '#6e1023',
              track: '#c98a0c',
              knob: '#6e1023',
              pointer: '#1c0b05',
              muted: '#5c0f1c',
              glow: '#6e1023',
              font: 'kalam',
              labelFont: 'kalam',
              valueFont: 'kalam',
            },
            background: [{ kind: 'color', color: '#f2b01e' }],
          },
        },
        el({
          kind: 'canvas',
          name: 'The tanpura',
          code: TONIC_CIRCLE,
          rect: r(0, 0, 760, 520),
        }),
        // The bridge, over the canvas: how loud the drone is, the bone paling up it (the canvas runs the strings from it).
        ...control('mlevel', 'ui.meter', 'Bridge', null, r(BRIDGE.x, BRIDGE.y, 14, 52), {
          style: {
            skin: { name: 'bar', params: { fill: '#fff1d6', surface: '#c4925f', scale: false } },
          },
        }),
        wire('gl1.out', 'mlevel.in'),
        // The name, signed on the gourd over the strings, in bone.
        el({
          kind: 'text',
          name: 'Title',
          text: 'Tonic',
          rect: r(CENTRE.x - 60, CENTRE.y - 82, 120, 38),
          textStyle: { font: 'kalam', size: 28, weight: 700, color: '#fff1d6', align: 'center' },
        }),
        ...NOTE_NAMES.map((name, pc) => {
          const a = ((pc + 0.5) / 12) * Math.PI * 2 - Math.PI / 2;
          const x = CENTRE.x + Math.cos(a) * NAME_R,
            y = CENTRE.y + Math.sin(a) * NAME_R;
          return el({
            kind: 'text',
            name: `${name} name`,
            text: name,
            rect: r(Math.round(x - 18), Math.round(y - 11), 36, 22),
            textStyle: { font: 'system', size: 17, weight: 700, color: 'accent', align: 'center' },
          });
        }),
      ],
    ],
  );
}
