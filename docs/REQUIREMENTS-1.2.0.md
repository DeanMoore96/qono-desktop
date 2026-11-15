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

The version bump in this branch checks the last item only as a package version. The product behavior above is not built yet.

## Desktop implementation plan

The Electron shell owns first-run consent. The per-model connect UI lives in the qono.net web app.

1. On startup, before `loadURL("https://qono.net")`, show a consent window in the shell. It states the disclosure in requirement 1 and has an explicit agree action. The remote page does not load until that action is taken. Closing the consent window without agreeing must not start the page, screen capture, or the microphone.
2. Store the acceptance (and the disclosure version the user accepted) in the app's user data. A later change to the disclosure requires a new acceptance.
3. Add a tray menu item to review the disclosure and to withdraw consent. Withdrawal clears the stored acceptance, hides or closes the Qono page, and shows the consent window again before the page can load.
4. After consent, the shell loads qono.net. The site then runs onboarding in this order: the model-connect step (Connect ChatGPT, Connect Claude, and the other per-model buttons, each opt-in, each disconnectable), then the rest of the features. The shell does not connect to a model.
5. Voice choice, the AI-voice disclosure, and the ban on ChatGPT and Claude app voices are part of the web app. The desktop shell does not ship or select those voices itself, and it does not add an endorsement or a model name to the app title.
