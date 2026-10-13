# Aura Voice CX

A zero-cost, browser-native AI voice customer-support workspace for the fictional
brand **Aura Skincare**. The support agent, **Aria**, handles real order-tracking,
cancellation, return, shipping and COD requests against a deterministic typed
policy engine — in the browser, with no paid APIs and no paid hosting.

Beyond the call itself, the workspace gives each signed-in customer a **profile
and address book**, stores every session so an **admin portal** can assess the
agent, lets approved answers be **fed back** into the agent's prompt, and speaks
**five languages** (English · हिन्दी · বাংলা · தமிழ் · मराठी).

> **Budget: ₹0.** Speech recognition and synthesis use the browser's built-in
> Web Speech API. The conversation, tool-calling and policy logic are pure
> TypeScript running in Next.js Route Handlers (or entirely in the browser as a
> fallback). Hosting targets the Vercel free tier. No OpenAI, no paid STT/TTS,
> no paid database (optional MongoDB Atlas free tier), no observability SaaS.

---

## What it actually does

- **Live voice loop** — press *Start voice call*, Aria greets you, the browser
  transcribes your speech, the server decides the reply, and Aria speaks it back.
- **Typed, deterministic order + policy engine** — every answer is derived from
  three mock orders and a written policy. Aria never invents courier names,
  tracking numbers or dates.
- **Honest transcripts and outcomes** — each call ends with a structured JSON
  outcome (`Intent`, `ResolutionStatus`, executed/blocked actions, unresolved
  items) plus a downloadable transcript.
- **Scripted scenarios** — six one-click scenarios replay realistic calls
  through the *real* engine (clearly labelled as scripted, never mixed with live
  mic input) so the flows can be demonstrated without speaking.
- **Graceful degradation** — if the API or the browser's speech APIs are
  unavailable, the app says so plainly and switches to text input and/or the
  in-browser fallback engine. It never shows a green "online" light it hasn't
  verified.

---

## Try it in three minutes

1. `npm install && npm run dev`, then open <http://localhost:3000>. Sign in with
   the prefilled **demo account** (any valid email + password ≥ 6 chars); Google
   sign-in appears too if you supply `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.
2. Click **Track ORD-101** under *Scripted scenarios* — watch the activity
   timeline fill with real tool calls and read the outcome panel.
3. Click **Cancel ORD-103** — Aria cancels a *Processing* order, and the outcome
   JSON records an `executed` cancellation.
4. Click **Return ORD-102** — a return is *denied* because it was delivered 14
   days ago; the outcome records `UNRESOLVED` and no executed return.
5. (Optional) Press **Start voice call** and say
   *"Where is my order ORD-101?"* to exercise the live mic + speech path.

---

## Architecture

```
┌─────────────────────────────────────────────── Browser (React 19) ──┐
│  Workspace                                                           │
│   ├── useCallSession  ── call state machine (idle→listening→…→ended) │
│   ├── VoiceAdapter                                                   │
│   │     ├── BrowserSpeechRecognizer  (Web Speech Recognition)        │
│   │     └── BrowserSpeechSynthesizer (Web Speech Synthesis)          │
│   └── engineClient  ── server-first transport                         │
│           └── in-browser fallback engine (same pure TS modules)       │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  POST /api/support/turn { text, state }
                               ▼
┌─────────────────────────── Next.js Route Handler ───────────────────┐
│  1. zod-validate the request                                        │
│  2. runSupportAgent(...)  ── enterprise agent, if a local model is  │
│        reachable and its output passes the guardrails               │
│  3. otherwise createEngine(createRequestRepository(state.actions))  │
│  4. orchestrator.processTurn(text, state)                           │
│        classify intent → identify order → run tools → apply policy  │
│        → build reply + events + next state                          │
└──────────────────────────────────────────────────────────────────────┘
```

Everything below the HTTP boundary (`src/lib/domain/*`) is dependency-free
TypeScript, so the **exact same engine** runs on the server and in the browser.

### Why the server is stateless

Serverless instances are ephemeral and can serve different users. Instead of
relying on process memory, the client sends the actions it has already executed
with every turn, and `createRequestRepository(actions)` replays them onto a
**fresh copy of the fixtures**. A cancellation stays idempotent and the server
holds no per-user state for the conversation itself.

> **Persistence is separate and best-effort.** Profiles, addresses, sessions and
> the knowledge base live in a `Repositories` layer (`src/lib/server/db/`) that
> uses **MongoDB Atlas** when `MONGODB_URI` is set and a process-local
> **in-memory store** otherwise. A storage failure never blocks a customer from
> getting their answer — it is wrapped and the call still completes.

---

## The voice lifecycle

`idle → connecting → listening ⇄ thinking → speaking → listening … → ended`

- **connecting** — the mic meter starts (RMS level feeds the orb animation).
- **listening** — recognition runs; partial text is shown as it is recognized.
  Recognition is stopped the moment a final transcript arrives so Aria's own
  voice is never transcribed.
- **thinking** — the turn is sent to the server; a "thinking" state is shown.
- **speaking** — the reply is spoken. On end, the app returns to *listening*.
- **ended** — audio stops and the structured outcome is generated and stored in
  local history (last 12 calls).

Hardening: every session carries a token. A turn or speech callback that
resolves **after** the call ended (or after a new call started) is discarded, so
late events can never corrupt a finished call.

---

## The enterprise agent layer (LLM understanding, code authority)

Aria ships with an optional **agent loop** (`src/lib/server/agent.ts`) that gives
the assistant genuine language understanding without ever letting a model make a
business decision. It is designed to hold up across a large, long-tail B2C
support volume:

```
runSupportAgent({ text, state, repo })
  │  system prompt + customer context
  ▼
Ollama /api/chat  (tools, stream:false, temperature:0)   ← up to 4 steps
  │  model may call: lookup_order · check_cancellation · check_return ·
  │                  check_shipping · check_cod · check_damaged_product ·
  │                  escalate_to_human
  │  each call is executed by policy.ts — the model only receives results
  ▼
submit_understanding  (REQUIRED structured step)
  → { intent, order_id, confidence, sentiment, needs_clarification,
      needs_escalation, reason, draft_reply? }
  ▼
override → orchestrator.processTurn(text, state, override)   ← authoritative
  → actions executed, policies enforced, reply + events produced
  ▼
guardrails → optional draft reply accepted or rejected
```

**Separation of powers.** The model *understands and explains*; the code
*decides and acts*. Cancellations, return windows, COD limits and shipping
boundaries are all evaluated by `policy.ts`, never by the model.

**Prompt context.** The system prompt carries few-shot routing exemplars, and the
last few turns of the conversation are replayed (`buildUserContext`) so the model
resolves pronouns and follow-ups ("and ORD-102?") instead of treating each
utterance in isolation. Client-observed agent behaviour (model-assisted turns,
draft accept/reject) is persisted per session and surfaced in the admin insights.

**Guardrails (`validateDraft`).** A model-authored reply is used **only** when:

- the intent is purely informational (`ORDER_TRACKING`, `COD_QUERY`,
  `SHIPPING_QUERY`) and the turn is `RESOLVED` with no policy-boundary wording;
- it contains no order id, courier or tracking reference that was not actually
  observed in tool results for *this* turn (`ORD-777`, `BlueDart`/`Delhivery`
  and `XX-000000` patterns are all checked);
- a tracking reply carries the `mock` disclaimer.

Anything else is discarded and the deterministic engine reply is used instead —
and the rejection is recorded as a visible activity event. If Ollama is
unreachable, times out, loops past the step cap, or answers without the
structured step, the whole agent path returns `null` and the request falls back
to the pure rule-based engine. **The app is fully functional with no model.**

---

## Authentication

The workspace is gated — unauthenticated visitors are redirected to `/login`.

- **Google OAuth** via Auth.js (NextAuth v5), enabled automatically when
  `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are present.
- **Demo credentials** provider (email + password ≥ 6 chars) so the app is fully
  testable offline with no external setup. `/signup` uses the same provider.
- JWT sessions — no database required (keeps the ₹0 constraint intact).

---

## Multilingual support

Aria can hold the conversation in **English, Hindi, Bengali, Tamil and Marathi**
(`src/lib/domain/locale.ts`). Pick a language from the selector in the header, or
set a preferred language on your profile and the workspace seeds it on your next
visit.

- Reply texts live in a single catalog (`src/lib/domain/messages.ts`); the
  orchestrator emits **message keys**, not literals, so every state (greeting,
  clarifications, policy decisions, tracking, denials) is localisable.
- The intent classifier understands native-script keywords (`कहाँ है`,
  `कैंसिल`, `ফেরত`, `எங்கே`, `रद्द` …) **and** romanised spellings (`kahan`,
  `cancel`, `wapas`, `kharab`, `nagad` …), so typers need not switch scripts.
- English is the canonical fallback: a missing translation falls back to English
  rather than breaking a turn. Policy **details** (event text, summaries) stay in
  English; only the *spoken reply* is localised, so the audit trail stays stable.
- Order ids, courier names and tracking references are never translated.

---

## Account, profile & persistence

Signing in gives you more than a gate:

- **Profile** (`/profile`) — full name, phone and preferred language, plus a
  **delivery address book** with create / update / delete and a single default
  address rule.
- **Session history** — every completed call is stored (`mode`, `intent`,
  `resolution`, language, summary, turn count) and shown on your profile.
- **Storage** — `src/lib/server/db/repositories.ts` exposes one async interface
  with two interchangeable backends: MongoDB Atlas (`MONGODB_URI`) and an
  in-memory store. With no `MONGODB_URI`, the app is fully functional and resets
  on restart — ideal for a ₹0 local demo.

---

## Admin portal & the learning loop

The admin portal (`/admin`) is guarded by an email allowlist (`ADMIN_EMAILS`).
**When the allowlist is empty the portal is closed to everyone**, which is the
safe default for a public deployment.

- **Assess the agent** — aggregate session stats (resolved / unresolved /
  escalated / out-of-scope / resolution rate) and a table of recent sessions.
- **Insights** — derived analytics (`src/lib/server/analytics.ts`): escalation and
  unresolved rates, the **top unresolved topics** (grouped by intent, with real
  example summaries), and **coverage gaps** — intents customers actually raised
  that still have no approved answer. It also reports how often the optional model
  answered a turn and the guardrail's draft accept/reject ratio. These are
  descriptive ratios over stored data, never targets or invented scores.
- **Agent evaluation** — a one-click harness (`src/lib/server/evaluation.ts`)
  replays all six assessment scenarios through the *real* orchestrator on a fixed
  clock and shows a pass/fail badge plus every individual check. It asserts the
  same guarantees as the unit tests (ORD-101 tracks with BlueDart, ORD-103
  cancels, ORD-102's return is denied, ORD-999 invents nothing, off-topic is
  declined, an ambiguous order question asks instead of guessing).
- **Curate knowledge** — add, edit, approve, unapprove and delete reusable
  answers. Only **approved** entries are ever injected into the agent prompt.
- **The loop** — after an unresolved or escalated call, the outcome route creates
  a **pending knowledge suggestion** from that session (prefilled with Aria's last
  reply). An admin edits it into an answer and approves it; the next matching
  utterance retrieves it (ranked BM25-style search) and adds it to the agent's
  context. This is retrieval + human review, not fine-tuning — so it stays
  explainable and ₹0.

Knowledge informs *wording only*: tool results and `policy.ts` remain the sole
source of truth for every decision.

---

## Tool-calling flow (deterministic, no LLM required)

```
classifyIntent(text)                     → Intent (+ needsClarification)
  ├─ extractOrderId / canonicalOrderId   → "ORD-103"
  ├─ canHandleWithoutOrder(intent)       → shipping / COD / product / out-of-scope
  ├─ if order id missing/unknown         → clarifying turn, no fabrication
  └─ else run the matching tool:
        trackOrder / requestReturn / cancelOrder /
        quoteShipping / checkCod / reportDamage
            ↓ reads orderRepository + policy.ts
        returns { reply, resolution, executed actions, events, unresolved }
```

Each turn emits **activity events** (`intent_detected`, `order_service_queried`,
`policy_checked`, `action_executed`, …) that drive the timeline UI and make the
reasoning observable.

### Scored intent, honest uncertainty

The classifier (`src/lib/domain/intent.ts`) is not a first-match keyword list. It
collects **weighted evidence** per intent (phrase and token weights, English,
native-script and romanised keywords such as *kahan*, *wapas*, *kharab*), applies
**negation** handling ("I don't want to cancel"), and scores every candidate to
produce a confidence plus runner-up alternatives.

- **Abstention.** When two *action* intents score within a small margin of each
  other, the classifier refuses to guess: it returns `UNKNOWN` with an
  `order_action` clarification ("Would you like to track, cancel or return?").
  The orchestrator forces that intent so no action is ever taken on a coin-flip.
- **Tone.** A light sentiment pass (`detectSentiment`) recognises frustration and
  confusion and prefixes a short, sincere empathy line — but only when the turn is
  *not* resolved, and never for out-of-scope requests. It changes wording, never
  policy.

Ranked knowledge retrieval (`rankKnowledge`) matches approved answers with a
BM25-style term score plus fuzzy matching (a one-edit typo still hits), then
boosts entries whose intent and language match the current turn.

---

## Policy enforcement (in code, not in a prompt)

| Rule | Behaviour encoded in `policy.ts` |
| --- | --- |
| Free shipping | Orders **> ₹499** ship free; **< ₹499** incur ₹50. |
| ₹499 exactly | **Explicitly unresolved** — Aria says the policy doesn't specify it and refuses to guess. |
| Delivery ETA | 3–5 business days. |
| Returns | Within **7 days** of delivery, unopened packaging only. |
| Damaged product | Must be reported within **48 hours**. |
| Cancellation | Allowed **only while the order is Processing**. |
| Cash on Delivery | Available up to **₹2,500**. |

---

## Mock data (the single source of truth)

`FIXTURE_VERSION = "assessment-orders-v1"` — three orders, never extended:

| Order | Customer | Item | Amount | Status | Courier / tracking |
| --- | --- | --- | --- | --- | --- |
| ORD-101 | Priya Sharma | Vitamin C Serum (30ml) | ₹699 | Out for Delivery | BlueDart / BD-982103 — "Expected by 6 PM today" |
| ORD-102 | Rahul Verma | Hydrating Sunscreen SPF 50 | ₹499 | Delivered | Delhivery / DL-441029 — "Delivered 14 days ago" |
| ORD-103 | Ananya Patel | Green Tea Face Wash + Toner | ₹850 | Processing | *no courier / no tracking* — "Ordered 3 hours ago; eligible for cancellation." |

ORD-103 intentionally has **no courier or tracking number**; Aria reports that
gap instead of filling it in.

---

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
```

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server. |
| `npm run build` | Production build. |
| `npm start` | Serve the production build. |
| `npm test` | Run the Vitest suite (162 tests). |
| `npm run test:watch` | Watch mode. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |

No environment variables are required for the app to run. Authentication falls
back to the built-in demo provider, and the agent falls back to the
deterministic engine. In production you should set `AUTH_SECRET` (see below).

---

## Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `AUTH_SECRET` | Recommended in prod | Signs Auth.js session tokens. A dev-only default is used if unset. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Optional | Enable the Google sign-in button. Without them only the demo provider is offered. |
| `AURA_ENABLE_LOCAL_AI` | Optional | `true` (default) to allow probing the agent path; `false` to disable it entirely. |
| `OLLAMA_BASE_URL` | Optional | Local Ollama endpoint (default `http://127.0.0.1:11434`). |
| `OLLAMA_MODEL` | Optional | Model used by the agent (default `llama3.2`). |
| `MONGODB_URI` | Optional | MongoDB Atlas connection string. When unset, an in-memory store is used. |
| `MONGODB_DB` | Optional | Database name (default `aura_voice_cx`). |
| `ADMIN_EMAILS` | Optional | Comma-separated allowlist for `/admin`. Blank closes the portal to everyone. |

---

## Optional local AI (off by default)

Aria works fully without any LLM. Optionally, a **local** [Ollama](https://ollama.com)
instance powers the enterprise agent: it understands free-form language, chooses
from the read-only lookup tools, and may compose an informational reply. It is
never allowed to make a policy decision or execute an action — those stay in
application code — and every drafted reply is checked by the guardrails above.
If Ollama isn't reachable, the app silently falls back to deterministic-only mode
and says so in the UI. No paid model, no API key, no data leaves the machine.

| Variable | Default | Meaning |
| --- | --- | --- |
| `AURA_ENABLE_LOCAL_AI` | `true` (probe only) | Set to `false` to disable the agent path entirely. |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Local Ollama endpoint. |
| `OLLAMA_MODEL` | `llama3.2` | Model used by the agent. |

```bash
ollama pull llama3.2
ollama serve
```

---

## Browser compatibility & graceful degradation

| Capability | Supported | Fallback when missing |
| --- | --- | --- |
| Speech recognition | Chromium browsers (Chrome, Edge) | Text input + scripted scenarios |
| Speech synthesis | Most modern browsers | Silent mode; transcripts still produced |
| API reachability | Always (local or Vercel) | In-browser deterministic engine |

The UI reflects the **real** capability of the environment. It never fakes a
recognition result and never displays an unverified "online" status.

---

## Testing

```bash
npm test        # 15 files, 162 tests
```

Coverage includes the policy engine, scored intent classifier (negation,
romanised and native-script keywords, ambiguity abstention), sentiment tone,
tool executor, orchestrator flows, outcome schema, the message catalog across all
five languages, the voice adapter error mapping, the stateless
request-repository replay, the persistence repositories (profile, address,
session and knowledge CRUD with stats and ranked search), admin analytics, the
six scripted scenarios run through the real engine, the in-app evaluation
harness, the demo-auth credentials, and the agent's guardrails — including
rejection of invented order ids / couriers, of drafts that claim a denied action
succeeded, and verification that approved knowledge reaches the model prompt.

---

## Deployment (Vercel free tier, ₹0)

1. Push the repository to GitHub.
2. Import it at <https://vercel.com/new>.
3. Set `AUTH_SECRET` (and `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` if you want
   Google sign-in). With no auth env vars at all, the demo provider still works.
4. Deploy with default settings.
5. The optional local AI simply stays unavailable in the cloud, which is the
   intended default; the deterministic engine serves every turn.

---

## Project structure

```
src/
├── app/
│   ├── api/                 health · orders · support/turn · support/outcome
│   │                        · ollama · auth/[...nextauth]
│   ├── login/ signup/       auth-gated entry pages
│   ├── profile/             profile + address book (server actions)
│   ├── admin/               admin portal: agent stats, insights, eval, knowledge CRUD
│   ├── globals.css          design tokens (ivory, charcoal, sage/forest accents)
│   ├── layout.tsx           Fraunces + Inter, real metadata
│   └── page.tsx             auth check → renders <Workspace/>
├── auth.ts                  Auth.js (NextAuth v5): Google + demo providers
├── components/              Header, LanguageSelector, AccountMenu, AuthPanel,
│                            VoiceWorkspace, VoiceOrb, ConversationPanel,
│                            ActivityTimeline, TestOrdersPanel, ScenarioLauncher,
│                            PostCallPanel, HistoryPanel, EvaluationPanel,
│                            Workspace, ui
├── lib/
│   ├── domain/              types · orders · policy · intent · tools · orchestrator
│   │                        outcome · transcript · locale · messages
│   │                        (pure, dependency-free, tested)
│   ├── server/              agent · agentTools · engine (stateless repo replay)
│   │                        · analytics · evaluation · ollama · validation
│   │                        · demoAuth · authEnv · adminEnv · userContext
│   │   └── db/              types · client · repositories (Mongo ↔ in-memory)
│   ├── voice/               adapter · web-speech · mic · mock
│   └── client/              useCallSession · engineClient · scenarios · labels …
```

---

## Design notes

An editorial, calm aesthetic: warm ivory canvas, charcoal ink, fine borders and
restrained sage/forest accents with a serif display face. Reduced-motion
preferences are respected (the voice orb stops animating). No neon,
glassmorphism or invented metrics.

---

## Honest limitations

- The three orders are **fictional fixtures**, not live logistics data.
- Web Speech recognition quality varies by browser, accent and microphone; the
  text input is always available as an equal path.
- The engine is deterministic and rule-based by design. It handles the assessed
  intents well and **politely declines** anything outside them rather than
  hallucinating. COD/shipping/return eligibility is explained from policy only.
- Local history is stored in `localStorage` on the device. Durable profiles,
  sessions and knowledge require `MONGODB_URI`; without it the in-memory store is
  used and resets on restart.
- The optional agent only runs against a **local** Ollama model, so in the
  deployed demo it is unavailable by default. It degrades to the deterministic
  engine rather than failing, and its free-text replies are accepted only for
  verified informational turns.

---

## Assessment questions

> _Paste the four questions from the DataStraw brief here and I'll complete each
> answer below._
