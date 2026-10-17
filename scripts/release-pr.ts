// Finds the release pull request whose merge produced a push to main. The Release workflow runs on that push rather
// than on the pull request event, so the signing environment, which only main may use, never runs workflow code from
// an unmerged pull request. The pull request is looked up from the merge commit instead of read from the event.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** The fields of GitHub's "pull requests associated with a commit" response that the release depends on. */
export interface PullRequestSummary {
  number: number;
  merged_at: string | null;
  merge_commit_sha: string | null;
  base: { ref: string };
  head: { ref: string; sha: string; repo: { full_name: string } | null };
}
export interface ReleasePullRequest { number: number; branch: string; reviewed: string }

/** The merged release pull request from this repository whose merge commit is `sha`, or null if the push is not one. */
export function releasePullRequest(pulls: PullRequestSummary[], sha: string, repository: string): ReleasePullRequest | null {
  const merged = pulls.find(pull => pull.merged_at && pull.merge_commit_sha === sha);
  if (!merged || merged.base.ref !== 'main' || merged.head.repo?.full_name !== repository || !merged.head.ref.startsWith('release/v')) return null;
  return { number: merged.number, branch: merged.head.ref, reviewed: merged.head.sha };
}

async function main() {
  const { SHA = '', GITHUB_REPOSITORY = '', GITHUB_OUTPUT } = process.env;
  if (!/^[a-f0-9]{40}$/.test(SHA) || !/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY)) throw new Error('Missing or invalid SHA or GITHUB_REPOSITORY.');
  let pulls: PullRequestSummary[] = [];
  // GitHub links a merge commit to its pull request shortly after the push.
  for (let attempt = 0; attempt < 6 && !pulls.length; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 10_000));
    pulls = JSON.parse(execFileSync('gh', ['api', `repos/${GITHUB_REPOSITORY}/commits/${SHA}/pulls`], { encoding: 'utf8' })) as PullRequestSummary[];
  }
  // main only accepts pull requests, so every push has one. Fail visibly instead of silently skipping a release.
  if (!pulls.length) throw new Error(`No pull request is linked to ${SHA} yet. Rerun the Release workflow.`);
  const release = releasePullRequest(pulls, SHA, GITHUB_REPOSITORY);
  const outputs = release ? ['release=true', `number=${release.number}`, `branch=${release.branch}`, `reviewed=${release.reviewed}`] : ['release=false'];
  if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
  console.log(release ? `${SHA} merged release pull request #${release.number} (${release.branch}).` : `${SHA} did not merge a release pull request; nothing to publish.`);
}

if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
