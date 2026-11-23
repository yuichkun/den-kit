# Usage receiver

The usage receiver takes the [usage data](usage.md#help-improve-den-kit) that den-kit's macOS
app sends, keeps it in a Cloudflare D1 database, and counts it each day. It runs on Cloudflare
Workers, apart from den-kit, from `receiver/`: `receive.ts` answers the app, `store.ts` keeps
and counts, `dashboard.ts` shows the counts, and `migrations/` makes the tables.

## What it keeps

| What                                                                                   | For how long                      |
| -------------------------------------------------------------------------------------- | --------------------------------- |
| Each event as sent, with the day it happened and the time it arrived                   | 45 days after the day it happened |
| Each install's first and last day with an event                                        | 45 days after its last day        |
| Counts that hold no ID (below), and how many records arrived and were skipped each day | Until someone deletes them        |

It keeps nothing else of a request: no address it came from and no header. The Worker writes no
logs.

## What it counts

Shortly after each UTC day ends, the receiver counts each of the 45 days before it again, so that
events that arrive late still count, and then deletes the events and installs past their time.

| Table          | Counts                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `active`       | Installs that sent an event in a day, or in a week from Monday, in all and by version, OS and CPU type (the 100 of each with the most installs)         |
| `event_counts` | Each event's count in a day, and the installs that sent it                                                                                              |
| `cohorts`      | For the installs whose first event was on a day: how many sent an event on day 1, 7 and 30 after it, and how many sent each event in their first 7 days |

Days are the computer's own UTC days. An event more than 44 days old, or dated more than a day
ahead, is skipped, and so is a record of another shape than the app's. An install that sends
nothing for 45 days counts as new when it comes back.

## Read the counts

`https://stats.den-kit.com` shows the counts to the people that the Cloudflare Access
application in front of it lets in (Set up and deploy): installs active each day and each week,
by version and OS; how many new installs sent an event on day 1, 7 and 30; how many did each of
opening den-kit, playing a sound, changing a work, asking the AI and exporting a work in their
first 7 days; AI requests, code parts added and exports each day; and the records received each
day against the limit. Each chart has a table of its values. A week's share for day 1, 7 or 30
shows once every install new that week has reached that day.

The Worker checks the token that Access adds to each request (`access.ts`), so the page stays
closed also without Access in front of it, and there is no page while `TEAM_DOMAIN` or
`POLICY_AUD` in `wrangler.jsonc` is empty. For anything the page does not show, use SQL, in
`receiver/`:

```sh
vp exec wrangler d1 execute den-kit-usage --remote --command "SELECT * FROM cohorts ORDER BY day DESC LIMIT 20"
```

## Limits

- It answers only `POST /events` with the app's body: at most 100 records in 64 KiB. Any other
  body is refused, and the app drops it.
- It takes at most `DAILY_RECORDS` (`store.ts`) records a day, counting those it skips, which
  limits what a day of it costs. It answers 429 to a batch that does not fit in what is left of
  the day, and the apps keep up to 1,000 events each and send them later
  (`desktop/analytics.ts`). Before real use comes near it, raise it; `intake` holds each day's
  records. Deployed with `DAILY_RECORDS` at 0, it takes nothing until it is raised again.

## Set up and deploy

In `receiver/`, with a Cloudflare account that has den-kit.com:

1. `vp install --frozen-lockfile`, then `vp exec wrangler login`.
2. Create the database in the EU. A database's jurisdiction is set when it is created and cannot
   change ([D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/)):

   ```sh
   vp exec wrangler d1 create den-kit-usage --jurisdiction=eu
   ```

   Put the ID it prints in `wrangler.jsonc` as `database_id`.

3. `vp run migrate` makes the tables, and `vp run deploy` deploys the Worker at
   `usage.den-kit.com` and `stats.den-kit.com`.
4. Set the release variable `DEN_KIT_USAGE_URL` to `https://usage.den-kit.com/events`
   ([RELEASE.md](../RELEASE.md)).
5. Put an Access application in front of the page only, not in front of the whole Worker: the
   app sends to `usage.den-kit.com` without signing in. In the Cloudflare dashboard, go to
   **Zero Trust** > **Access controls** > **Applications** > **Create new application** >
   **Self-hosted and private**, add the public hostname `stats.den-kit.com`, and allow the people
   who may read the counts
   ([Publish a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)).
   Put the team domain, `https://<team-name>.cloudflareaccess.com` (**Zero Trust** >
   **Settings** shows it), and the application's **Application Audience (AUD) Tag**, in its
   **Additional settings**, in `wrangler.jsonc` as `TEAM_DOMAIN` and `POLICY_AUD`
   ([Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)),
   then `vp run deploy` again.

Deploy a receiver that knows a new event before releasing a den-kit that sends it: until then, the
receiver skips it. A change to the tables is a new file in `migrations/`
(`vp exec wrangler d1 migrations create den-kit-usage <name>`), applied with `vp run migrate`
before `vp run deploy`.

To try a change in the Workers runtime with a local database:

```sh
vp exec wrangler d1 migrations apply den-kit-usage --local
vp exec wrangler dev --local --test-scheduled
```

The daily run starts with `curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=15+0+*+*+*"`.

## Requests to see or delete data

A person writes to the address that Settings shows, with their install ID. In `receiver/`:

- `vp run data show <id>` prints what the receiver keeps for the ID.
- `vp run data delete <id>` deletes it, and prints what is left, which is nothing.

The counts hold no ID, so they stay. While the person keeps usage data on, new events arrive with
the same ID; turning it off in Settings stops them.
