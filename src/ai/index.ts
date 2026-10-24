// ai: requests to the AI and what den-kit gives it. It holds the request flow
// (sending, progress, stopping), the context sent with a request (the selection,
// sketches and sticky notes, what the person is looking at, pictures of a
// shared screen), the tools (reading the work, applying operations, listening,
// looking at the screen, assets, workspace commands), each agent's scope and one
// conversation per work. Model calls, retries, sub-agents and conversation state
// belong to the agent runtime behind the host's AI interface
// (docs/principles.md, principle 5). Every change the AI makes is an operation.
export {};
