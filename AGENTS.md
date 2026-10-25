# Working on den-kit

How the team works on den-kit, for every AI agent working with the team, such as Codex
and Claude Code. The team reads it too.

Team members change den-kit with AI agents. The sources this file points to say what
den-kit is, what it delivers, and how it should look, behave and be built. Every change
is checked against them, by CI and AI review first and then by @yuichkun, so that team
members can decide on their own without losing what den-kit delivers or how it is
designed, and the final review stays light. This works only when each fact has exactly
one source: two copies drift apart, and agents that read different copies judge the same
change differently.

## Read these first

At the start of every session, before you answer a request or change anything, read the
sources below. Work often starts from a conversation rather than a finished issue, so
get the background yourself instead of waiting to be told. Do not rely on your own
memory or global settings for den-kit: when they disagree with these sources, the
sources are right. If you cannot open one of them, tell the person you work with before
you go on.

- Product notes: what den-kit is, its decisions, the team and who decides what, and
  links to the plan in Linear.
  https://app.notion.com/p/3f4449b4e81d8121999df097392ad056
- Value list: what den-kit delivers to the people who use it. It is the goal the team
  works toward.
  https://app.notion.com/p/3fd449b4e81d81b08b9ccba312262907
- Design direction: https://app.notion.com/p/3f9449b4e81d81e5b63ad0b8c2ed3aa3
- The Linear issue for the work, when there is one:
  `https://linear.app/escentier/issue/<ID>`, where `<ID>` is the issue in the branch name.
- [docs/principles.md](docs/principles.md), and the sources in this repository for the
  area you will touch (see Where things are).

The Codex review on GitHub is the one exception: it reads only the repository, because
its comments are public (see Review guidelines).

## Where things are

How the code works lives in this repository, next to the code, because it changes with
the code. What den-kit is for, the plan and the decisions live in Notion and Linear.

| Topic                                                                    | Source of truth                                                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Introduction and downloads                                               | [README.md](README.md)                                                                                              |
| Using den-kit, and its known limitations                                 | [docs/usage.md](docs/usage.md)                                                                                      |
| Running from source, building the macOS app, Storybook, checks and tests | [docs/development.md](docs/development.md)                                                                          |
| Rules every change follows, and their priority                           | [docs/principles.md](docs/principles.md)                                                                            |
| Modules, how data moves between them, their interfaces                   | [docs/architecture.md](docs/architecture.md)                                                                        |
| A module's role and its rules                                            | The comment at the top of the module                                                                                |
| Releases                                                                 | [RELEASE.md](RELEASE.md)                                                                                            |
| Code parts, the `kit` API, and what the in-app AI reads in the workspace | [pod-template/AGENTS.md](pod-template/AGENTS.md) and [pod-template/src/kit/index.ts](pod-template/src/kit/index.ts) |
| What CI runs                                                             | [.github/workflows/ci.yml](.github/workflows/ci.yml)                                                                |
| What a pull request description holds                                    | [.github/pull_request_template.md](.github/pull_request_template.md)                                                |
| Sources of the bundled showcase assets                                   | [public/showcase/SOURCES.md](public/showcase/SOURCES.md)                                                            |

## How to work

- Do not guess. When the sources do not answer something, say so and ask, and keep what
  you checked apart from what you think.
- Link to a fact's source instead of copying it, in docs, comments, issues and pull
  requests, and in this file: when a topic gets its own document, add a row to the table
  above instead of repeating the topic here.
- Keep docs short. Before you add anything to a doc or a comment of any kind, look for
  outdated text you can delete, and check whether updating what is there would do
  instead of adding.
- When your change makes a source in this repository wrong, update it in the same pull
  request. When two places disagree, or a source no longer matches the code, tell the
  person you work with instead of choosing one yourself.
- If a request would work against a value, or change what den-kit delivers to the people
  who use it, check with @yuichkun before you build it.

## Rules for the repository

The repository and GitHub are public.

- Write everything in the repository and on GitHub in English: code, comments, docs, UI
  copy, tests, commit messages, pull requests, issues and review comments. In chat with
  the team, use Japanese.
- Do not write the real names of team members. Refer to a role, such as "a maintainer",
  or mention a GitHub account.
- Notion and Linear are private. Do not copy, quote or summarize them in the repository
  or on GitHub; the one exception is README's description of what den-kit is for.
- Keep issue IDs out of commit messages and pull request titles and descriptions.
- Docs and code comments describe the current state only: do not write how things used
  to be or what changed, such as "previously", "now uses" or "was changed to". Changes
  are recorded in commit messages, pull requests and release notes.

## Rules for changes

- Keep each change focused. Add or update tests for any change in behavior.
- Do not weaken a test to make it pass. If an assertion has to loosen, the behavior it
  checks has changed: say which behavior changed and why in the pull request.

## Pull requests

1. Branch from current `main`. Name the branch after the Linear issue when there is one,
   such as `sua-123-short-name`.
2. Run the checks that cover the change; [docs/development.md](docs/development.md)
   lists them.
3. Open the pull request ready for review and fill in the template. CI and the Codex
   review start automatically.
4. Judge every review finding by the sources above, not by who raised it: fix what they
   show is wrong, and reply with the reason for the rest. Then ask for another review
   with a top-level `@codex review` comment.
5. Compare the change with the value list. Post the result in Japanese as a comment on
   the Linear issue for the work, or tell the person you work with when there is no
   issue: whether the change works against any value, which values it brings closer, and
   anything it adds that the list does not cover.
6. When CI passes and the latest Codex review has no open findings, ask @yuichkun for a
   review. Only @yuichkun merges pull requests and publishes releases.

## Review guidelines

These apply to the Codex review on GitHub and to any agent that reviews a pull request.

- On GitHub, use only this repository as the source of review criteria, and do not open
  or cite Notion or Linear: review comments are public.
- Look for bugs and regressions first, then for anything that breaks
  [docs/principles.md](docs/principles.md), then for changed behavior without tests.
- Flag code that no longer matches a doc or a module's header comment, changes that make
  a source of truth wrong without updating it in the same pull request, and added doc or
  comment text that repeats another source or leaves outdated text next to it.
- Flag anything that breaks Rules for the repository or Rules for changes.
