// KV helper functions
async function getCount(env, key) {
  const v = await env.COUNTERS.get(key);
  return v ? Number(v) : 0;
}

async function incr(env, key) {
  const n = (await getCount(env, key)) + 1;
  await env.COUNTERS.put(key, String(n));
  return n;
}

async function reset(env, keys) {
  await Promise.all(keys.map((k) => env.COUNTERS.put(k, "0")));
}

// Customize this to match your API’s JSON structure
function parseAvailability(payload) {
  return payload.available ?? 0;
}

async function getTimes(env, key) {
  const v = await env.COUNTERS.get(key);
  try {
    return v ? JSON.parse(v) : [];
  } catch {
    return [];
  }
}

async function appendTime(env, key, ts) {
  const arr = await getTimes(env, key);
  arr.push(ts);
  await env.COUNTERS.put(key, JSON.stringify(arr));
}

export default {
  async scheduled(event, env, ctx) {
    const now = new Date(event.scheduledTime);
    const h = now.getUTCHours();
    const m = now.getUTCMinutes();
    const d = now.getUTCDate();
    const w = now.getUTCDay();

    // Monthly summary: 1st @ 18:29 UTC
    if (h === 18 && m === 29 && d === 1) {
      return ctx.waitUntil(monthlySummary(env));
    }
    // Weekly summary: Saturday @ 18:29 UTC
    if (h === 18 && m === 29 && w === 6) {
      return ctx.waitUntil(weeklySummary(env));
    }
    // Daily summary: every day @ 18:29 UTC
    if (h === 18 && m === 29) {
      return ctx.waitUntil(dailySummary(env));
    }
    // Otherwise, regular 15-minute check
    return ctx.waitUntil(runCheck(env));
  },
};

async function runCheck(env) {
  const url = env.API_URL;
  const ts = new Date().toISOString();
  console.log(`${ts} - Checking stock at ${url}`);

  let available = 0;
  let errored = false;

  try {
    const res = await fetch(url);
    console.log(`${ts} - HTTP ${res.status}`);

    if (!res.ok) {
      console.log(`${ts} - Fetch failed`);
      errored = true;
    } else {
      const payload = await res.json();
      available = parseAvailability(payload);

      if (available > 0) {
        await appendTime(env, "daily:inTimes", ts);
        console.log(`${ts} - In stock: ${available}`);
        await postToTelegram(env, `Product in stock: ${available}`);
        console.log(`${ts} - Telegram alert sent`);
      } else {
        console.log(`${ts} - Out of stock`);
      }
    }
  } catch (err) {
    console.error(`${ts} - Error: ${err.message}`);
    errored = true;
  }

  // Update all counters
  const periods = ["daily", "weekly", "monthly", "all"];
  await Promise.all(periods.map((p) => incr(env, `${p}:total`)));

  const outcome = errored
    ? "errors"
    : available > 0
    ? "inStock"
    : "outStock";
  await Promise.all(periods.map((p) => incr(env, `${p}:${outcome}`)));
}

async function dailySummary(env) {
  const keys = ["daily:total", "daily:inStock", "daily:outStock", "daily:errors"];
  const [total, inStock, outStock, errors] = await Promise.all(
    keys.map((k) => getCount(env, k))
  );

  // Group recorded in-stock timestamps into intervals
  const raw = (await env.COUNTERS.get("daily:inTimes")) || "[]";
  const stamps = JSON.parse(raw).sort();
  const epochs = stamps.map(Date.parse);
  const groups = [];
  let curr = [];

  for (const e of epochs) {
    if (!curr.length || e - curr[curr.length - 1] === 15 * 60 * 1000) {
      curr.push(e);
    } else {
      groups.push(curr);
      curr = [e];
    }
  }
  if (curr.length) groups.push(curr);

  const toIST = (ms) =>
    new Date(ms).toLocaleTimeString("en-GB", {
      timeZone: "Asia/Kolkata",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });

  const intervals = groups
    .map((g) => {
      const start = g[0];
      const end = g[g.length - 1] + 15 * 60 * 1000;
      return `${toIST(start)} - ${toIST(end)}`;
    })
    .join(" and ");

  let msg =
    `Daily summary: runs=${total} runs, in-stock=${inStock} runs, ` +
    `out-of-stock=${outStock} runs, errors=${errors} runs`;
  if (intervals) {
    msg += ` Product was in stock between ${intervals}.`;
  }

  await postToTelegram(env, msg);
  await reset(env, keys);
  await env.COUNTERS.put("daily:inTimes", "[]");
}

async function weeklySummary(env) {
  const keys = ["weekly:total", "weekly:inStock", "weekly:outStock", "weekly:errors"];
  const [total, inStock, outStock, errors] = await Promise.all(
    keys.map((k) => getCount(env, k))
  );
  const msg =
    `Weekly summary: runs=${total} runs, in-stock=${inStock} runs, ` +
    `out-of-stock=${outStock} runs, errors=${errors} runs`;
  await postToTelegram(env, msg);
  await reset(env, keys);
}

async function monthlySummary(env) {
  const keys = ["monthly:total", "monthly:inStock", "monthly:outStock", "monthly:errors"];
  const [total, inStock, outStock, errors] = await Promise.all(
    keys.map((k) => getCount(env, k))
  );
  const msg =
    `Monthly summary: runs=${total} runs, in-stock=${inStock} runs, ` +
    `out-of-stock=${outStock} runs, errors=${errors} runs`;
  await postToTelegram(env, msg);
  await reset(env, keys);
}

async function postToTelegram(env, text) {
  const ts = new Date().toISOString();
  const apiUrl = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: env.CHAT_ID, text });

  console.log(`${ts} - Sending Telegram message`);
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    console.error(`${ts} - Telegram failed: ${res.status}`);
  }
}