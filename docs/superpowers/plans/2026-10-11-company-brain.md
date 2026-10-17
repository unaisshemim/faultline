# Company Brain — Small MVP Plan

**Goal:** Build a local working demo where the founder chats with AI to create and assign work, then sees employee updates and automatic follow-ups.

**Stack:** Vite + React + TypeScript + shadcn/ui frontend; Hono + TypeScript on Node.js backend; FalkorDB as the only database; OpenAI through the Vercel AI SDK for founder chat.

**Scope:** One sample company, one founder, and three seeded employees. This is a workflow demo, not a production launch. Only this plan is being changed; implementation has not started.

## What we will build

1. Founder tells AI, “Prepare the monthly inventory report by Friday.” No task-creation form.
2. AI asks conversationally for missing details such as estimated effort or an ambiguous deadline, then calls backend tools to check employees and capacity.
3. When the request is clear, AI creates and assigns the task through backend tools, reports the exact deadline and ownership reason, and shows a task card in chat. The employee receives a message in a clearly labeled simulated Teams conversation. If nobody qualifies, AI creates an unassigned task and explains the conflict.
4. Employee accepts, declines, requests clarification, reports progress/a blocker, or completes the task.
5. The founder sees the updated task and any blocker.
6. The backend sends a simple follow-up when an active task has not received an update.
7. Founder asks what is blocked or who can take a task; answers use stored company data.

The simulated conversation is a testing tool for this demo. The eventual employee interface remains Microsoft Teams. No real messages are sent in this version.

## Keep the app small

| Screen | Content |
| --- | --- |
| Dashboard | Main founder AI conversation, with active task counts, overdue work, blockers, and recent updates alongside it |
| Tasks | Task list and detail panel, owner/reason, progress and messages; “Create task” opens the founder chat |
| Team | Three employees, responsibilities, weekly capacity, and current assigned effort |

Put the simulated Teams conversation in a collapsible demo panel. Select a seeded employee and a specific task before replying so updates cannot accidentally change another task. Use shadcn/ui buttons, cards, dialogs, inputs, selects, badges, and tables. Handle loading, empty, and API failure states; disable duplicate submissions.

## Minimal architecture

```text
Vite founder app → Hono API → FalkorDB
                       ├── Vercel AI SDK → OpenAI → validated backend tools
                       └── follow-up timer → simulated message records
```

- FalkorDB stores the actual employees, tasks, updates, messages, and follow-up times. There is no second database or graph synchronization layer.
- Use the official Node client and parameterized OpenCypher from the backend. Reference: [FalkorDB clients](https://docs.falkordb.com/getting-started/clients).
- Run one Hono process with `@hono/node-server`; keep the exported app separate from startup for route checks. Reference: [Hono on Node.js](https://hono.dev/docs/getting-started/nodejs).
- Use npm workspaces for `apps/web` and `apps/api`, with a small shared TypeScript contract folder. Use native fetch for ordinary API reads and the AI SDK React chat hook for streamed founder conversation.
- Keep database credentials and AI keys on the backend. Bind the unauthenticated demo to localhost and use synthetic company data.
- Run FalkorDB locally with a persistent volume, using a pinned image. Restarting the API must not erase tasks or messages.

## Minimal data model

| Node | Fields |
| --- | --- |
| Employee | ID, name, department, responsibilities, weeklyCapacityHours |
| Task | ID, title, description, requiredResponsibility, dueAt, effortHours, status, blockerText, lastUpdateAt, nextFollowUpAt |
| Update | ID, task ID, employee ID, text, kind, createdAt, origin |
| Message | ID, task ID, employee ID, direction, text, createdAt, kind, dedupeKey |
| FounderChat | ID, SDK-compatible conversation messages/tool results, updatedAt |

Relationships: employee `OWNS` task; update `UPDATES` task; employee `AUTHORED` update; message `ABOUT` task. Use stable IDs. Store dates in UTC and display them in the demo company's configured timezone.

Task states: `unassigned`, `awaiting_acceptance`, `accepted`, `in_progress`, `blocked`, `completed`, `cancelled`. Declining returns the task to `unassigned`; clarification leaves it pending and adds an update. Overdue is derived from deadline, not a separate state. Only the assigned employee may accept/update/complete through the demo panel; the founder can reassign or cancel.

## Simple coordination rules

**Assignment:** Match the required responsibility exactly. Subtract the effort of all nonterminal assigned tasks, including pending acceptance, from weekly capacity. Suggest the qualified employee with the most remaining capacity who can fit the new task; break ties by stable employee ID. Show the calculation. If nobody fits, leave it unassigned and explain why. This is a coarse demo estimate, not calendar-based scheduling. Missing responsibility or effort requires clarification rather than an arbitrary owner. Serialize assignment mutations within the single demo API process to avoid overlapping capacity checks.

**Updates:** Structured actions handle acceptance and completion. Free text is stored exactly as submitted; employee can choose “Progress” or “Blocked.” AI may suggest a classification when configured, but never silently completes or reassigns a task. Unknown dependency owners remain unknown.

**Follow-ups:** A backend timer checks persisted `nextFollowUpAt` values every 30 seconds. For the demonstration, use a two-minute interval and send “Any update on [task]?” to the simulated conversation. Reset the interval after an employee update. Skip completed, cancelled, and unassigned tasks; show unresolved blockers on the dashboard. Use a persisted key per task/scheduled interval to suppress duplicate reminders and resume from stored times after restart. Grouped check-ins and working-hours scheduling are deferred; label the accelerated interval as demo behavior.

**Founder AI chat:** Use only OpenAI through the Vercel AI SDK. Backend packages: `ai`, `@ai-sdk/openai`, and `zod`; frontend: `@ai-sdk/react` and `ai`. Configure `OPENAI_API_KEY` and `OPENAI_MODEL` on the server and select a tool-capable model available to the account. Connect directly with the OpenAI provider; no provider abstraction, AI Gateway, or separate Agents SDK is needed. References: [AI SDK OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai), [AI SDK chat UI](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot).

Use `useChat` with `DefaultChatTransport` pointing to Hono's `/api/chat`. Hono loads the stored chat, validates the incoming message, converts it to model messages, streams OpenAI output with `streamText`, and returns the SDK-compatible UI message stream. Persist text and tool results so clarification and task references survive reloads. Pin compatible SDK package versions together; use their documented stream response helper at implementation time.

Expose only three Zod-validated server tools:
- `getCompanyWork` — read employees, capacity, tasks, and blockers through fixed graph queries.
- `suggestOwner` — take a validated task specification and return eligible owners/rejection reasons.
- `createTask` — create from complete task fields, recheck capacity, select the eligible owner, persist task/message, and return the stored task ID, deadline, and assignment reason. The AI never invents an owner ID or bypasses assignment rules.

A clear founder instruction to create work authorizes creation; do not require a form or a separate confirmation click. Ask only for missing or ambiguous details. Resolve relative dates using the server's current date and company timezone, and show the exact date in the result. An AI effort suggestion remains an estimate and needs conversational agreement before capacity-based assignment. Backend tool execution enforces validation and idempotency; store the create result under a stable chat/request action key so retries do not create duplicate tasks or messages. Chat text alone never proves a task was created: the success card comes from the saved tool result. Read-only questions never create tasks. See [OpenAI tool calling](https://developers.openai.com/api/docs/guides/tools).

Limit tool steps per turn and report API/stream errors with a retry action. After a successful mutation, refresh dashboard/task/team data. If the stream disconnects after a write, recover the stored result before retrying it. Without an OpenAI key, show “Connect OpenAI to use founder chat”; seeded data and the employee demo remain viewable. No fake AI answers or alternate manual creation flow. This MVP uses text conversation; microphone input and voice synthesis are deferred.

## Small API

- `GET /api/dashboard` — task counts, blockers, recent updates.
- `GET /api/employees` — seeded team and calculated capacity.
- `GET /api/tasks` — list tasks; creation is performed by the validated server tool behind chat.
- `GET /api/tasks/:id` — task, owner, updates, messages.
- `POST /api/tasks/:id/respond` — employee action/update for that specific task.
- `POST /api/tasks/:id/cancel` — founder cancels and stops follow-ups.
- `GET /api/chat/:id` — load stored founder conversation.
- `POST /api/chat` — streamed OpenAI conversation with read/assignment/create tools.

Validate requests and return clear errors for unknown IDs, invalid actions, and insufficient capacity. Refetch affected dashboard/task/team data after mutations; poll the open conversation every five seconds to show automatic reminders.

## Build checklist

### 1. Foundation and stored sample data

**Files:** Root `package.json`, `.env.example`; `apps/web/` Vite scaffold and `components.json`; `apps/api/src/{app.ts,server.ts,graph.ts,seed.ts}`; `shared/contracts.ts`; `infra/compose.yaml`.

- [x] Scaffold Vite React TypeScript and configure shadcn/ui following its [Vite guide](https://ui.shadcn.com/docs/installation/vite).
- [x] Create the Hono API, graph connection, request validation, and localhost development configuration.
- [x] Seed Arjun (operations, 8 hours), Leena (operations, 16 hours), and Nisha (finance, 12 hours), with existing work consuming 6 hours for Arjun. Seed only missing data; resets are explicit.
- [x] Verify API health, stored employee reads, frontend build, and persistence after restart.

### 2. Founder AI chat, task creation, and assignment

**Files:** `apps/api/src/{chat.ts,chat-tools.ts,tasks.ts,assignment.ts,assignment.test.ts,chat-tools.test.ts}`; `apps/web/src/{pages/Tasks.tsx,pages/Team.tsx,components/FounderChat.tsx,components/ChatTaskCard.tsx}`.

- [x] Install the AI SDK packages and configure server-only OpenAI credentials/model, streamed Hono chat, and persisted conversation history.
- [x] Build the founder conversation with shadcn/ui, clarification replies, streaming/error states, and task cards from tool results. No create dialog or separate question box.
- [x] Implement the three backend tools, responsibility matching, effort accounting, decline handling, no-owner outcomes, and idempotent task creation.
- [ ] Verify a conversational four-hour inventory request selects Leena because Arjun has two hours left. Test missing effort/date clarification, nobody eligible, read-only questions, invalid tool inputs, replayed creation, and completion releasing capacity.

### 3. Employee responses and automatic follow-up

**Files:** `apps/api/src/{messages.ts,responses.ts,follow-ups.ts,follow-ups.test.ts}`; `apps/web/src/components/DemoTeamsPanel.tsx`; `apps/web/src/pages/Dashboard.tsx`.

- [x] Build the simulated employee conversation with accept/decline/clarify, progress/blocker updates, and completion.
- [x] Implement persisted follow-up scheduling in the Hono process and visible dashboard blockers/updates.
- [x] Verify identity/task checks, update persistence, one reminder per interval, restart recovery, and no reminders after completion/cancellation.

### 4. Complete AI walkthrough

**Files:** `apps/api/src/chat-tools.test.ts`; `apps/web/src/components/FounderChat.tsx`; `README.md`.

- [ ] Verify “What is blocking operations?” and “Who has capacity for this task?” work in the same founder conversation using stored data and task links.
- [ ] Verify live OpenAI task creation, multi-turn clarification, chat reload, disconnected stream recovery, no-key/error states, and no duplicate writes on retry. Keep tool execution tests deterministic; separately record the real OpenAI walkthrough.
- [x] Run typecheck, build, and focused assignment/follow-up/API tests. Walk through create → assign → accept → blocked → follow-up → complete → no more reminders.
- [x] Document the few commands needed to start FalkorDB, Hono, and Vite, plus demo limitations.

## Deferred from this MVP

PostgreSQL/Drizzle, additional queue services, graph projections, multi-company accounts, authentication/onboarding, manager dashboards, enterprise permissions, calendar/leave scheduling, reporting, broad audit systems, deployment infrastructure, production retry guarantees, Outlook ingestion, and live Teams installation/messaging.

Once the local workflow proves useful, connect the same assignment and response handlers to a real Teams bot. Add Outlook context afterward. Live integrations require proper identity verification and authorized source access before using real company communications.

## Done means

We can run the app locally, create the inventory task by chatting with real OpenAI through the AI SDK, explain its owner, simulate an employee response, observe an automatic follow-up, see a blocker on the founder dashboard, ask about current work, and complete the task. FalkorDB retains the records after restart, and completed work stops receiving reminders. Employee messages are unmistakably labeled as simulated; founder chat uses real OpenAI.

Implementation note: task/message/follow-up logic is consolidated in `work.ts`; frontend views live in `App.tsx` to keep the MVP small. Deterministic SDK/assignment/lifecycle tests and real FalkorDB verification pass. Live OpenAI walkthrough remains pending local API key configuration. All UI controls including the sidebar use shadcn, and Inter is the only font.
