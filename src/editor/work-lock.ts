// One window per work: a work open in one den-kit window is refused in another,
// since both would save it and its project disk would be used from both. The
// Web Locks API holds a lock per work across every window of den-kit's origin;
// the window keeps it until it opens another work or closes.
export class WorkLock {
  private held: { id: string; release: () => void } | null = null;
  private claims = new Map<string, Promise<boolean>>();

  /** Hold the lock of a work (letting go of the one held before); false when another window holds it. */
  claim(id: string): Promise<boolean> {
    if (this.held?.id === id) return Promise.resolve(true);
    let claim = this.claims.get(id);
    if (!claim) {
      claim = this.request(id).finally(() => this.claims.delete(id));
      this.claims.set(id, claim);
    }
    return claim;
  }

  private async request(id: string): Promise<boolean> {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    if (!locks?.request) return true;
    let release: () => void = () => {};
    const got = await new Promise<boolean>(resolve => {
      void locks
        .request(`den-kit:work:${id}`, { ifAvailable: true }, lock => {
          if (!lock) {
            resolve(false);
            return null;
          }
          resolve(true);
          return new Promise<void>(done => {
            release = done;
          });
        })
        .catch(() => resolve(true));
    });
    if (got) {
      this.held?.release();
      this.held = { id, release };
    }
    return got;
  }
}
