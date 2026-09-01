# Testing the realtime chat end to end

A deterministic, repeatable check of the three things that keep failing by hand:
**presence** (the online count), the **typing indicator**, and **live message delivery** —
plus a regression check that a tab switch no longer tears the channel down.

## Why not Strix

Strix is an autonomous **security**-testing agent — it hunts auth bypasses, injection and
access-control flaws in a Docker sandbox. This is not a security bug. It is a WebSocket
protocol handshake where one frame (`presence_state`) never arrives, so pointing a pentest
agent at it will not surface the cause.

The right tool is **Playwright**, which is already configured in this repo
(`playwright.config.ts`, chromium, reuses your running dev server). **No Docker needed** —
you can stop the container if it is only running for this.

---

## One-time check

Playwright and its chromium build are already installed. If `npx playwright test` ever
complains about a missing browser:

```bash
npx playwright install chromium
```

---

## Step 1 — open a terminal in the project

```bash
cd ~/Desktop/trekker-main
```

## Step 2 — start the dev server (leave it running)

```bash
npm run dev
```

Leave this terminal alone. Playwright reuses a server already on port 3000
(`reuseExistingServer`), so it will not start a second one.

## Step 3 — open a SECOND terminal tab

`Cmd + T` in Terminal/iTerm, then:

```bash
cd ~/Desktop/trekker-main
```

## Step 4 — supply the two accounts

The two members of the test conversation are **`achutakeshavam@gmail.com`** and
**`rexaba2099@emaxasp.com`** (confirmed against the live DB — they are the only two
participants of conversation `acaf4728-0921-4db8-8431-8947679bfbd1`).

Export them in the second terminal. **Do not commit these** — they live in your shell only:

```bash
export E2E_A_EMAIL='achutakeshavam@gmail.com'
export E2E_A_PASSWORD='<password>'
export E2E_B_EMAIL='rexaba2099@emaxasp.com'
export E2E_B_PASSWORD='<password>'
```

The conversation id is already the default. To test a different one:

```bash
export E2E_CONVERSATION_ID='<other-conversation-uuid>'
```

## Step 5 — run it, watching the browsers

```bash
npx playwright test e2e/realtime-chat.spec.ts --headed
```

Two chromium windows open side by side and drive the whole flow. Drop `--headed` to run it
invisibly. To step through it manually at each assertion:

```bash
npx playwright test e2e/realtime-chat.spec.ts --debug
```

---

## Step 6 — read the result

Every realtime frame from both sessions is printed, prefixed `[A]` and `[B]`. The test
fails at the **first** thing that is actually broken, which is the point — it names the
failure instead of leaving you to infer it.

### If it fails on `2 online`

Presence is not syncing. The likely cause is the `presence: { enabled: true }` flag in the
channel config no longer reaching the server — Realtime made presence opt-in server-side, and
the pinned `realtime-js` (2.11.15, via supabase-js 2.51.0) never sends it on its own. Without
that flag the server skips the initial `presence_state` frame, `RealtimePresence.joinRef`
stays null, and every `presence_diff` is buffered instead of dispatched, silently.

If a client upgrade changed the join payload, the fix is to finish the upgrade:

```bash
npm install @supabase/supabase-js@latest
npm run build && npm test
```

`@supabase/ssr@0.6.1` peers `^2.43.4`, so 2.112.x satisfies it — but this bumps `auth-js`,
`postgrest-js` and `storage-js` together, so re-check login, signup and password reset.

### If presence passes but typing fails

Presence and broadcast are independent paths, so this points at the binding filter or the
3-second expiry timer, not the transport.

### If it fails on the final tab-focus check

Delivery or the online count broke after backgrounding the tab. That is the channel lifecycle
regressing — the `user` → `uid` dependency narrowing plus the teardown gates in
`src/app/(trekker)/messages/page.tsx` — and has nothing to do with presence.

---

## Debugging a failure

The page ships no realtime logging. To watch the frames while diagnosing, temporarily add
this to `MessagesPageContent` — `realtime-js` routes every frame through a hook that is a
no-op by default:

```ts
useEffect(() => {
  supabase.realtime.logger = (kind: string, msg: string, data?: unknown) => {
    console.log(`[rt:${kind}]`, msg, data ?? '');
  };
}, [supabase]);
```

Run the spec with `--headed` and read the browser console. Take it out again when done.
