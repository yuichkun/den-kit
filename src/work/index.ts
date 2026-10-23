// work: the work as data. A work is one instrument or effect: its document (the
// patch, the parameters it exposes and the plugin screen) and its files. Every
// change to a work is a typed operation that records who made it and the state
// it replaces; an operation that does not fit is refused as a whole and leaves
// the work as it was (docs/principles.md, principle 3). History undoes whole
// steps. Works and their files are checked for type and size before they are
// used. work imports no other module of den-kit; what it needs to know about
// blocks it gets as a Catalog from whoever opens the work.
export {};
