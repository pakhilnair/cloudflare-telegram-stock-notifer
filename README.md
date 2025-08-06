Stock Notifier Worker

A generic Cloudflare Worker that:

- Polls any JSON API endpoint at configurable intervals
- Tracks total runs, in-stock runs, out-of-stock runs, and errors over daily/weekly/monthly/all-time periods
- Records exact in-stock time intervals (for daily summaries)
- Sends immediate in-stock alerts and periodic summaries to a Telegram chat
- Can be paused or resumed by toggling Wrangler environments
  While this was originally built for the Amul product API, you can adapt it to any API that returns a stock count in JSON.

---

Table of Contents

1. Prerequisites
2. Clone & Install
3. KV Namespace Setup
4. Configure wrangler.toml
5. Environment Variables & Secrets
6. Local Testing
7. Customize for Your API
8. Deploy & Manage
9. Pausing & Resuming
10. Monitoring
11. How It Works
12. License

---

Prerequisites

- Node.js v18+
- npm or Yarn
- A Cloudflare account with Workers & KV enabled
- A Telegram bot token and target chat ID

---

Clone & Install

    git clone https://github.com/your-org/stock-notifier-worker.git
    cd stock-notifier-worker
    npm install

---

KV Namespace Setup

1. Authenticate Wrangler (if not done yet):

   wrangler login

2. Create a new KV namespace:

   wrangler kv namespace create "NOTIFIER_COUNTERS"

3. Copy the returned namespace id (e.g. e29b263ab50e42ce9b637fa8370175e8).

---

Configure wrangler.toml

Edit wrangler.toml at the project root:

    name               = "stock-notifier-worker"
    main               = "index.js"
    compatibility_date = "2025-08-02"
    type               = "javascript"

    # Live cron schedule
    [triggers]
    crons = [
      "*/15 * * * *",   # every 15 minutes
      "29 18 * * *",    # daily summary @ 23:59 IST → 18:29 UTC
      "29 18 * * 6",    # weekly summary Sat @ 23:59 IST → 18:29 UTC
      "29 18 1 * *"     # monthly summary 1st @ 23:59 IST → 18:29 UTC
    ]

    # Bind your KV namespace
    kv_namespaces = [
      { binding = "AMUL_COUNTERS", id = "<YOUR_NAMESPACE_ID>" }
    ]

    # Observability (optional)
    [observability]
    enabled            = true
    head_sampling_rate = 1.0

    [observability.logs]
    enabled = true

    # Paused environment (no scheduled triggers)
    [env.paused]
    [env.paused.triggers]
    crons = []

- Replace <YOUR_NAMESPACE_ID> with the ID from the previous step.
- AMUL_COUNTERS is the binding name used in code—keep it or rename consistently.

---

Environment Variables & Secrets

The Worker expects three bindings:

- env.API_URL – the JSON endpoint to poll
- env.CHAT_ID – your Telegram chat ID
- env.TELEGRAM_TOKEN – your bot token

Using secrets (recommended)

    wrangler secret put API_URL
    wrangler secret put CHAT_ID
    wrangler secret put TELEGRAM_TOKEN

Then remove these from any [vars] block in wrangler.toml.

---

Local Testing

1. Miniflare

   npm install --save-dev miniflare

Create mf.js:

    import { Miniflare } from "miniflare";
    import "dotenv/config";

    const mf = new Miniflare({
      scriptPath: "./index.js",
      modules: true,
      globals: {
        API_URL:        process.env.API_URL,
        CHAT_ID:        process.env.CHAT_ID,
        TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
      },
    });

    (async () => {
      console.log("Simulating a scheduled event…");
      const res = await mf.dispatch("scheduled", {
        scheduledTime: new Date(),
      });
      if (res.errors.length) console.error(res.errors);
    })();

Run:

    API_URL="https://api.example.com/stock" \
    CHAT_ID="12345" \
    TELEGRAM_TOKEN="abc:DEF" \
    node mf.js

2. Quick Node Wrapper

Create run.js:

    import "dotenv/config";
    import worker from "./index.js";

    const env = {
      API_URL:        process.env.API_URL,
      CHAT_ID:        process.env.CHAT_ID,
      TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
      AMUL_COUNTERS:  /* mocked KV binding or real binding via Miniflare */,
    };

    const ctx = { waitUntil: (p) => p };

    (async () => {
      await worker.scheduled({ scheduledTime: new Date() }, env, ctx);
    })();

Then:

    npm install dotenv
    API_URL="…" CHAT_ID="…" TELEGRAM_TOKEN="…" node run.js

---

Customize for Your API

1.

URL
In runCheck() the script reads env.API_URL. Point it to your endpoint.

2.  Parsing
    Update the helper parseAvailability(payload) at the top of index.js to extract your API’s stock field:

        function parseAvailability(payload) {
          // e.g. return payload.stockCount ?? 0;
          return payload.available ?? 0;
        }

3.  Cron Timing
    Adjust crons = [ ... ] in wrangler.toml as desired (remember they use UTC).

---

Deploy & Manage

Deploy with crons enabled (live)

    wrangler deploy --env ""
    # or shorthand
    wrangler deploy -e ""

Deploy paused (no scheduled runs)

    wrangler deploy --env paused
    # or shorthand
    wrangler deploy -e paused

---

Pausing & Resuming

- Live: scheduled polls & summaries run on cron.
- Paused: no cron triggers—Worker only responds to direct fetch events (if any).
  Switch by publishing to either the root env or paused env as shown above.

---

Monitoring

Tail logs:

    wrangler tail --env ""

View invocation details, errors, and console output in real time.

---

How It Works

1.

runCheck (every 15 min):

    - Fetches API_URL
    - Parses stock count
    - Logs outcome
    - If in stock, records timestamp & sends immediate Telegram alert
    - Increments KV counters for daily/weekly/monthly/all-time totals, in-stock, out-of-stock, errors

2.  dailySummary (once per day):

        - Reads and resets daily counters
        - Reads recorded in-stock timestamps, groups into contiguous 15 min intervals, converts to IST
        - Sends a single summary Telegram message

3.  weeklySummary & monthlySummary run similarly for their intervals.

---

License

This project is released under the MIT License. Feel free to fork, adapt, and contribute!
