# Qono 1.2.0 requirements

From [issue #1](https://github.com/DeanMoore96/qono-desktop/issues/1), agreed with Dean on Nov 15, 2026. These apply to the qono.net web app and to every desktop build. This document records them. It does not implement them. No release or tag until Dean approves.

## 1. Consent with full disclosure before download, install, and first run

Users must see a full disclosure and actively agree before they download, install, or first use Qono.

The disclosure must cover exactly what the app does on the user's computer:

- Screen reading: what is captured, and when.
- Screen editing and interaction: what it can click, type, or change.
- Voice commands: microphone use.
- What data it accesses, what it sends, and where it goes.
- Which AI models it can connect to, stated as the user's choice (requirement 2).

Nothing runs until the user agrees. Consent is recorded and can be reviewed or withdrawn in the app.

## 2. Opt-in per-model in-app connect buttons

Qono never connects to ChatGPT, Claude, or any other model on its own.

Each model has its own connect button built into the app (Connect ChatGPT, Connect Claude, and others), reachable without leaving Qono. The user can disconnect any model at any time from inside the app.

## 3. Onboarding order

Qono's core value depends on the model the user connects, so connecting a model is the main path.

The order is: consent, then model connect, then features.

## 4. Voices

Approved voices are OpenAI developer (API) voices only, such as Alloy, Coral, Marin, and Cedar. See the [OpenAI text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech).

- Tell users that the voice is AI-generated, not a human.
- Make no claim of endorsement by OpenAI, and do not put a model name in the app title. See the [OpenAI brand guidelines](https://openai.com/brand/).

Not allowed: voices from the ChatGPT app ([Service Terms §8](https://openai.com/policies/service-terms/), non-commercial only) or from the Claude app. Claude's API has no voice output. If Claude is used for text, pair it with a separate voice provider. If Claude is connected, tell users they are talking to AI ([Anthropic usage policy](https://www.anthropic.com/legal/aup)).

## Acceptance checklist

- [ ] A consent screen with the full disclosure is shown before download (site) and on first run (desktop), and blocks use until accepted
- [ ] Per-model connect and disconnect buttons are in the app
- [ ] Onboarding goes consent, then model connect, then features
- [ ] The voice picker offers only OpenAI API voices and shows an AI-voice disclosure
- [ ] The website copy matches the disclosures
- [ ] Version bumped to 1.2.0, with no release or tag until Dean approves

The version bump in this branch checks the last item only as a package version. Desktop first-run consent, the post-consent connect URL, and `qono://` routing are implemented in the shell. Per-model buttons, the voice picker, and the website download disclosure are still the qono.net app, not this repository.

## Proposed qono:// links (proposed, pending Dean)

Exact link mapping was an open question. The shell registers the `qono://` protocol and uses this map until Dean confirms it:

| Link | Opens |
| --- | --- |
| `qono://consent` | The local consent window (review if already accepted) |
| `qono://connect` | `/connections` |
| `qono://connect/chatgpt` | `/connections?provider=openai` |
| `qono://connect/claude` | `/connections?provider=anthropic` |
| `qono://voices` | `/voices` |

A link that needs the website is held until consent is accepted, then the shell loads that path on qono.net. A second launch forwards the URL to the running instance. `https://` links still open in the default browser. ChatGPT maps to `provider=openai` and Claude to `provider=anthropic` only as this proposal.

## Desktop implementation plan

The Electron shell owns first-run consent. The per-model connect UI lives in the qono.net web app.

1. On startup, before `loadURL("https://qono.net")`, show a consent window in the shell. It states the disclosure in requirement 1 and has an explicit agree action. The remote page does not load until that action is taken. Closing the consent window without agreeing must not start the page, screen capture, or the microphone.
2. Store the acceptance (and the disclosure version the user accepted) in the app's user data. A later change to the disclosure requires a new acceptance.
3. Add a tray menu item to review the disclosure and to withdraw consent. Withdrawal clears the stored acceptance, hides or closes the Qono page, and shows the consent window again before the page can load.
4. After consent, the shell loads qono.net. The site then runs onboarding in this order: the model-connect step (Connect ChatGPT, Connect Claude, and the other per-model buttons, each opt-in, each disconnectable), then the rest of the features. The shell does not connect to a model.
5. Voice choice, the AI-voice disclosure in the product voice picker, and the ban on ChatGPT and Claude app voices are part of the web app. The consent window states that Qono uses OpenAI API voices, that the voice is AI-generated, and that Qono does not claim an OpenAI endorsement. The shell does not put a model name in the app title.
6. After consent, the shell loads `QONO_START_URL` (`https://qono.net/connections?onboarding=1`). If that page fails to load, it falls back to `https://qono.net`. `QONO_URL` replaces the start URL for local tests.

## Account and billing stay in the browser

The desktop app has no account, billing, subscription, or credit-management controls. Using Qono stays in the app: the workspace, screen sharing and reading, on-screen actions and approvals, voice, instructions, model connect, voices, and consent. Only account settings, billing, subscriptions, checkout, and credit management open in the normal browser.

The guard is an allowlist-safe blocklist in `account-guard.js`. A path on the interactive allowlist is never sent out. Only an explicit account or billing path on qono.net, or a Stripe or PayPal host, is opened with `shell.openExternal`. The shell then shows: "Account and billing open on qono.net in your browser."

Live routes checked in `https://qono.net/assets/index-BhiPvuiP.js` on Nov 16, 2026: `/workspace`, `/connections`, `/settings`, `/members`, `/dashboard` (under `/_admin`), `/thank-you`, plus login and support pages. Checkout is not a site path. The bundle starts Stripe or PayPal checkout and assigns `window.location` to the returned redirect URL. No Wix pay domain is in the bundle. `/voices` is the voice page (Dean, Nov 16) even though that path is not in this bundle yet. `/instructions` is treated as in-app the same way.

The tray has no account or billing controls. "Manage account on qono.net…" opens `https://qono.net/settings` in the browser.

### User-agent contract

The shell keeps the default Chromium user agent and appends one token:

`QonoDesktop/<app version>`

For this build that is `QonoDesktop/1.2.0`. The website can hide account and billing menus when the user agent contains `QonoDesktop/`. The shell still blocks those routes if a link is followed.
