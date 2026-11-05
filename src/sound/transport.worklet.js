// A clock and optional quiet audition click, evaluated at audio sample time.
// Snapshot corrections arrive over the port; their arrival never triggers a beat.
class TransportClock extends AudioWorkletProcessor {
  constructor() {
    super();
    this.snapshot = null;
    this.click = false;
    this.previousBeat = null;
    this.clickAge = Infinity;
    this.clickFrequency = 1320;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'clock') {
        // A remote stop and restart can both happen between host snapshots.
        // Its event identity resets pulse history even if both snapshots play.
        if (data.snapshot?.transportId !== this.snapshot?.transportId) this.previousBeat = null;
        this.snapshot = data.snapshot;
      } else if (data.type === 'click') this.click = data.enabled === true;
    };
  }

  process(_inputs, outputs) {
    const clock = outputs[0];
    const click = outputs[1][0];
    const snapshot = this.snapshot;
    for (let i = 0; i < click.length; i++) {
      const time = currentTime + i / sampleRate;
      const running =
        snapshot && snapshot.playing && time >= snapshot.startTime && time < snapshot.expires;
      clock[0][i] = snapshot?.tempo ?? 120;
      let pulse = false;
      if (running) {
        let beat = snapshot.beat + ((time - snapshot.time) * snapshot.tempo) / 60;
        const starting = this.previousBeat === null && time - snapshot.startTime < 1 / sampleRate;
        // Link timestamps are integer microseconds. Its beat-zero timestamp can
        // round just before zero; do not create a second pulse on the next sample.
        if (starting && beat < 0 && beat > -snapshot.tempo / (60 * sampleRate)) beat = 0;
        const whole = Math.floor(beat + 1e-8);
        // On joining/resuming, wait for a beat unless this sample is the actual
        // scheduled start. Starting mid-beat must not invent an off-grid pulse.
        pulse = this.previousBeat === null ? starting : whole > this.previousBeat;
        // A small backward phase correction near an integer must not retrigger
        // the beat that was just played. Stop/start resets this high-water mark.
        this.previousBeat = Math.max(this.previousBeat ?? whole, whole);
        clock[1][i] = ((beat % 1) + 1) % 1;
        clock[2][i] = (((beat % 4) + 4) % 4) / 4;
        clock[3][i] = pulse ? 1 : 0;
        clock[4][i] = 1;
        if (pulse && this.click) {
          this.clickAge = 0;
          this.clickFrequency = ((whole % 4) + 4) % 4 === 0 ? 1760 : 1320;
        }
      } else {
        this.previousBeat = null;
        clock[1][i] = clock[2][i] = clock[3][i] = clock[4][i] = 0;
      }
      click[i] =
        this.click && running && this.clickAge < 0.025
          ? 0.15 *
            Math.sin(2 * Math.PI * this.clickFrequency * this.clickAge) *
            Math.exp(-this.clickAge * 220)
          : 0;
      this.clickAge += 1 / sampleRate;
    }
    return true;
  }
}

registerProcessor('den-kit-transport', TransportClock);
