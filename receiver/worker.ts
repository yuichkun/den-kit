// The usage receiver (docs/usage-receiver.md): a Cloudflare Worker that takes the usage events
// den-kit's desktop app sends (receive.ts), once a day counts them and deletes what is past its
// time (store.ts), and shows the counts at / to the people Cloudflare Access lets in
// (dashboard.ts). It writes no logs (wrangler.jsonc). The Workers runtime reads every export of
// this file as a handler, so it exports nothing else.
import { dashboard, type DashboardEnv } from './dashboard.ts';
import { dayOf } from './days.ts';
import { receive } from './receive.ts';
import { count } from './store.ts';

interface ScheduledController {
  scheduledTime: number;
}

export default {
  fetch: (request: Request, env: DashboardEnv) =>
    new URL(request.url).pathname === '/'
      ? dashboard(request, env, new Date())
      : receive(request, env, new Date()),
  scheduled: (controller: ScheduledController, env: DashboardEnv) =>
    count(env.DB, dayOf(new Date(controller.scheduledTime))),
};
