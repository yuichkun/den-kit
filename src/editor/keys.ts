// Who gets Enter. Enter from anywhere outside a text field jumps to the AI
// prompt, but a view can claim it first: Enter on a selected text opens it for
// typing, on a custom part opens its code. The AI panel hears keys before
// everything else, so it offers Enter to the claims before jumping.
type Claim = (e: KeyboardEvent) => boolean;
const claims = new Set<Claim>();

/** Take Enter when `claim` says so (it acts and returns true); returns the release. */
export function claimEnter(claim: Claim): () => void { claims.add(claim); return () => { claims.delete(claim); }; }

/** Offer Enter to the views; true when one of them took it. */
export function offerEnter(e: KeyboardEvent): boolean {
  for (const claim of claims) if (claim(e)) return true;
  return false;
}
