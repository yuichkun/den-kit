// The usage receiver (docs/usage-receiver.md): a Cloudflare Worker that takes the usage events
// den-kit's desktop app sends (receive.ts), and once a day counts them and deletes what is past
// its time (store.ts). It writes no logs (wrangler.jsonc). The Workers runtime reads every export
// of this file as a handler, so it exports nothing else.
import { dayOf } from './days.ts';
import { receive, type Env } from './receive.ts';
import { count } from './store.ts';

interface ScheduledController {
  scheduledTime: number;
}

export default {
  fetch: (request: Request, env: Env) => receive(request, env, new Date()),
  scheduled: (controller: ScheduledController, env: Env) =>
    count(env.DB, dayOf(new Date(controller.scheduledTime))),
};
