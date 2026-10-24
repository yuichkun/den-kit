// The Workspace interface: a pod, a Linux-like machine where the work's files
// run as a web project with bash, git, Node and npm. The host decides whether
// there is one and provides it; den-kit's workspace module drives it. Each work
// has a pod with a disk of its own, and a pod reaches the internet only while
// den-kit installs packages. Types only.

/** How one command runs. The command is a bash script, run with `bash` in `cwd`. */
export interface PodRunOptions {
  /** Working directory (default: the project). */
  cwd?: string;
  env?: Record<string, string>;
  /** Stop waiting after this long (the command is interrupted with ^C); null exit code then. */
  timeoutMs?: number;
  /** Each piece of output as it comes (cleaned text). */
  onOutput?(text: string): void;
}
export interface PodRunResult {
  /** The script's exit status; null when it was cut off or the pod could not say. */
  exitCode: number | null;
  /** What it printed (stdout and stderr together, cleaned, the end kept when long). */
  output: string;
  timedOut: boolean;
  ms: number;
}
/** A command left running (the dev server). */
export interface PodProcess {
  readonly name: string;
  /** Settles when it ends. */
  readonly done: Promise<void>;
  readonly running: boolean;
  /** The end of what it printed. */
  output(): string;
  /** Stop it (the process its script runs as, which stops what it started); settles when it has ended. */
  stop(): Promise<void>;
}
export interface Portal {
  url: string;
  port: number;
}

export interface PodHost {
  readonly kind: 'browserpod' | 'fake';
  /** The user's home inside the pod (absolute). */
  readonly home: string;
  run(script: string, options?: PodRunOptions): Promise<PodRunResult>;
  /** Start a long-running command; it keeps running after this returns. */
  start(name: string, script: string, options?: Omit<PodRunOptions, 'timeoutMs'>): PodProcess;
  /** Write a file, text or bytes (absolute path; directories are made). */
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  /** A text file's contents, or null when there is none. */
  readFile(path: string): Promise<string | null>;
  /** A server inside the pod opened a port and can be reached at `url` (also called for ports already open). */
  onPortal(listener: (portal: Portal) => void): () => void;
  /** Let the pod reach the internet (open) or not. It starts closed; den-kit opens it only to install packages. */
  network(open: boolean): void;
  /** Stop everything still running in the pod, what earlier commands left in the background included. */
  stopAll(): Promise<void>;
  /** How long after `sync` the pod's disk takes to keep what was written (none: sync is enough). */
  readonly settleMs?: number;
  /** Its file watching does not see folders made after a watcher started. */
  readonly watchMissesNewFolders?: boolean;
  dispose?(): void;
}

/** Whether this host provides a pod, and how to make one. */
export interface PodFactory {
  /** Which pod this is (null: none can be made; `reason` and `fix` say why). */
  kind: 'browserpod' | 'fake' | null;
  /**
   * Make the pod for one work (its id): each work has a disk of its own. `progress`
   * says what it is doing (starting a pod takes a while the first time).
   */
  create(work: string, progress?: (text: string) => void): Promise<PodHost>;
  reason?: string;
  fix?: string;
  /** The error the person sees when the pod fails, with what they can do about it. */
  explain?(error: unknown): unknown;
  /** Its first start takes minutes (packages to install): start it as soon as den-kit first opens. */
  startEarly?: boolean;
}
