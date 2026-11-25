# Code AI

A prompt-driven agent written in TypeScript that works with any OpenAI-compatible API: OpenAI, Ollama, LM Studio, OpenRouter, Groq, vLLM and others. There is no hard-coded routing. For each prompt, the model decides what to do next: answer directly, call a tool, make a plan for a multi-step task, or ask a clarifying question. It keeps deciding after every tool result until the job is done or a guardrail stops it.

## Quick start

```bash
npm install                 # installs every workspace, from the repo root
cp .env.example .env        # optional: port, log folder, eval model
npm start                   # builds everything, then serves the app at http://localhost:4000
                            #   add a model under Settings -> Models, then chat
npm run cli                 # chat in the terminal instead (add -- --workspace "Name" to pick one,
                            #   or -- --new "My app" --path ~/code/my-app to create one)
npm run ask -- "What is 18% of 52,300?"   # one prompt, then exit
npm test                    # offline tests, no API key or server needed
npm run eval                # behaviour evals against the real model (paid APIs bill for it)
```

While developing, run the API and the web app together with `npm run dev`, or each in its own terminal:

```bash
npm run dev                 # both below in one terminal (Ctrl+C stops both)
npm run dev:api             # API on http://localhost:4000, restarts on change
npm run dev:web             # web app on http://localhost:5173, proxies /v1 to the API
```

Needs Node 22.9 or later. There is no database to install: everything is saved in files.

### Desktop app

The same app in its own window, for people who don't want Node or a terminal. It runs the API on this machine (on `127.0.0.1:47821`) and shows the web app in an Electron window; workspaces, chats and settings are the same files in `~/.code-ai/`, so the browser and the desktop app see the same data (use one at a time on the same chat). Sign-in is always off in the desktop app.

```bash
npm run desktop             # build everything and open the desktop app from this checkout
npm run desktop:dist        # build the installer: apps/desktop/release/Code AI-<version>-mac-arm64.dmg
```

`desktop:dist` builds for the machine it runs on (a Mac builds the macOS `.dmg`; Windows builds an `.exe` installer). The app is ad-hoc signed, not signed with an Apple Developer ID, so the first time someone opens a downloaded copy macOS blocks it: they open it from System Settings → Privacy & Security → Open Anyway. The server's log is in `~/Library/Logs/Code AI/server.log`.

## Workspaces and storage

Everything is per **workspace**: its chats, its memories, its folder and its own instructions for the agent (for example a "My app" workspace on `~/code/my-app` and a "Research" workspace on `~/notes/research`). Switch or create workspaces from the menu at the top of the sidebar; the gear opens the workspace's settings.

Each workspace lives in a **folder you choose** on your machine: type the path or click **Browse…** when you create it (a missing folder is created). The agent's file tools work only inside that folder: they list, read, find, search, write, edit, create folders, move, copy and delete. Every change asks for your approval first (set **Settings → Agent → Tool approvals** to "Run without asking" to skip the prompts). Paths that lead outside the folder, the folder itself, and anything in `.git/` are refused, the app's own `.code-ai/` folder can't be read or changed by them, and the disk root or your home folder can't be a workspace.

The agent can also **run commands** (`run_command`): bash in the workspace folder, for installs, tests, builds, linters, scripts and git. Every command asks for approval, gets no input, stops at a timeout (120 s by default, 600 s at most) and has anything it left running in the background stopped when it ends. Commands never see this app's own settings (`.env` values, model API keys, ...). A few commands are refused even when approvals are off: `sudo`/`su`, recursive deletes of `/`, `~` or `..`, formatting disks, shutting down, and piping a download into a shell. This is a backstop, not a sandbox: a command runs with your user's permissions, so read what you approve.

**Attach files** in the chat with the paperclip, by dropping them on the message box or by pasting (a screenshot, say): images, PDFs, Word documents (`.docx`) and text files such as code, CSV, JSON or Markdown, up to 10 per message and 15 MB each. They upload right away and are kept privately in the workspace's `.code-ai/<workspace>/uploads/`, not in your project. The agent reads them with its own tools: `read_attachment` (the text of a PDF page by page, a Word document, or a text file), `view_image` (shows an image to the model; this needs a model that can see images) and `save_attachment` (copies one into the workspace folder, with your approval, e.g. to put an uploaded logo into a site).

There is no database. The app's own data is global to your machine, so it's kept in files in your home folder, `~/.code-ai/` (written readable only by you, since some hold API keys and tokens). Run logs (JSONL, for debugging) go to `~/.code-ai/logs/`; set `AGENT_LOG_DIR` to move them.

| File                  | Holds                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| `workspaces.json`     | the list of workspaces: id, name, folder path                            |
| `models.json`         | the models (Settings → Models), with their API keys                      |
| `agent-settings.json` | how the agent behaves (Settings → Agent)                                 |
| `mcp-servers.json`    | MCP servers in the `{ "mcpServers": … }` shape, turned on per workspace  |
| `mcp-trust.json`      | which workspace `mcp.json` files you approved (by workspace data folder) |

Everything else is saved in the workspace's own folder, under `.code-ai/<workspace>/` (`.code-ai/` ignores itself in git, and file tools can't reach it). `<workspace>` is the workspace's name made folder-safe: lowercase letters and digits, accents dropped, any other run of characters one `-`, at most 64 long ("Client Site / v2" is `client-site-v2/`; a name with no letters or digits, such as one in another script, gets `workspace-` and 8 characters from the name). So **several workspaces can use the same folder**, each with its own chats, memory, settings, uploads, skills, agents and MCP choices, as long as their names don't give the same folder name ("Foo" and "foo!" can't share a folder). Renaming a workspace or changing its folder moves its data along; deleting a workspace deletes only its own `.code-ai/<workspace>/` (and `.code-ai/` once nothing else is in it), and leaves the rest of the folder and other workspaces' data alone.

| File                        | Holds                                                   |
| --------------------------- | ------------------------------------------------------- |
| `settings.json`             | instructions, planning choice, tool groups turned off   |
| `memory.json`               | the workspace's saved facts                             |
| `chats/<id>/chat.json`      | title, current plan, earlier plans                      |
| `chats/<id>/messages.jsonl` | the conversation, exactly as sent to the model          |
| `chats/<id>/runs.jsonl`     | one line per request: status, steps, tools used, tokens |
| `mcp.json`                  | which of the app's MCP servers are on here              |
| `uploads/<id>/`             | an attached file (`file`) and its details (`meta.json`) |
| `skills/<name>.md`          | a skill: name and description up top, then the steps    |
| `agents/<name>.md`          | a specialist sub-agent, from the Agents tab             |

Adding a workspace with the same name on a folder that still has its `.code-ai/<workspace>/` (say, after deleting the workspace from the list, or on a new machine) brings its chats, memory and settings back.

Before, a folder had one workspace and its files sat right in `.code-ai/`. On start the app moves them into `.code-ai/<workspace>/` of the listed workspace using that folder (along with your approval of its `mcp.json`); a file the new place already has is left where it was, so nothing is overwritten or lost.

## How a prompt flows

```
you> prompt
  -> guardrails.checkInput
  -> 1. PLAN   planning step (one model call, no tools) decides:
                 "direct" -> go straight to the loop
                 "plan"   -> goal + steps + "done when", shown in the Plan panel
  -> 2. ACT    loop: model + tools (search, read pages, files, memory, ...)
                 the model ticks off plan steps, adds steps it discovers, re-plans if needed
  -> 3. CHECK  final answer with plan steps still open? sent back once to finish or explain
  -> 4. LIMIT  out of steps/tokens? one tool-free call writes up what was found
  -> answer

  messages you send while it works wait, and are added before its next model call
  (after a step's tool results) or before it settles on an answer
```

The agent decides by itself, per request, whether to plan: greetings, single questions and single lookups are answered directly; research over several items, gather-then-write tasks and anything easy to get half-done get a plan. Turn off **Settings → Agent → Plan multi-step work first** to skip the planning step.

This is a hybrid of the two common agent patterns: **plan-and-execute** for big tasks, **ReAct** (reason, act, observe, repeat) for small ones and inside each plan step.

## Web UI

`npm start` and open http://localhost:4000 (set `PORT` to change it; the dev proxy follows it). In development the web app runs on http://localhost:5173 instead (`npm run dev`).

- **Chat** with answers that stream in word by word, and live tool steps. Click a step to see its input and result. Text the agent writes on its way to a tool call shows as a muted note.
- **Approvals** appear as Allow/Deny cards when the agent wants to write a file.
- **Steer while it works:** the message box stays open during a run. What you send waits above the box ("Waiting for the next step") until the agent reads it: after the tool results of its current step, or just before it would finish. It then shows in the chat as your message ("Sent while the agent worked") and the agent carries on with it in mind: narrow the task, correct it, add to it, or say why you denied an approval. Text only; files and picked skills wait for your next message. If the run ends before reading a message, it goes back into the message box. Stop still ends the run at once.
- **Attachments:** the paperclip or paste adds files to the next message; they show as chips while they upload, and images as thumbnails in the sent message (click to open).
- **Sidebar:** the workspace switcher and the workspace's saved chats. Click to reopen a chat, double-click (or ✎) to rename, ✕ twice to delete. The open chat is in the page address, so reload and back/forward work.
- **Plans** appear in the conversation where the agent made them, folded (click to open). The plan being worked on is also docked above the message box (status, count, the current step; click for all steps), so its progress stays in view.
- **Side panel:** the workspace's files (click one to preview, search and copy it; drag one onto the message box to insert its full path; in the desktop app, files and folders dragged from Finder or File Explorer insert their full paths too, and a browser can only give their names), memories, MCP servers and an integrated terminal in the workspace folder.
- **New chat** starts another chat in the same workspace. The workspace's memories are kept.
- **Per-workspace planning and tools:** in a workspace's settings, Planning follows Settings → Agent or is on or off just there, and Tools turns off groups it doesn't need (files, commands, web, memory, plans). Off groups' tools and prompt rules aren't sent, so a chat-only workspace (a language tutor, say) uses far fewer tokens per message. Attachment and skill tools are only sent when a chat has files or the workspace has skills.
- **MCP tools on demand:** the MCP servers you turn on in a workspace are listed to the agent by tool name only; it loads the full definitions of the tools a task needs (`load_mcp_tools`) and only those are sent from then on. A plain message doesn't pay for a server's tools (Atlassian's are ~25K tokens).
- **Skills:** instructions you write for a kind of task (a ticket workflow, a review checklist) in the Skills tab under the side panel. The agent sees each skill's name and description and loads the one a task needs with `use_skill`; to choose yourself, pick skills for a message with the Skills button in the message box, and they're sent with it in full. A skill guides how the agent works; it never turns approvals off. To give a skill files of its own (references, templates, stylesheets), click **Upload** in the Skills tab and pick a skill folder with a `SKILL.md` at its top (front matter `name` and `description`, then the instructions), such as one from `~/.claude/skills/`. It is kept as `.code-ai/<workspace>/skills/<name>/`; the agent reads its files with `read_skill_file` and copies them into the project with `copy_skill_file` (which asks first).
- **Sub-agents (a team of specialists):** turn on Sub-agents in Settings → Agent and the agent can hand self-contained parts of a task to specialists with `delegate_task`, each working in a fresh context and reporting back:

  | Specialist   | Tools              | Notes                                               |
  | ------------ | ------------------ | --------------------------------------------------- |
  | `researcher` | web, files, memory | read-only; cites sources                            |
  | `coder`      | files, commands    | makes changes and checks they work                  |
  | `reviewer`   | files, web         | read-only; runs on the reviewer model if one is set |
  | `writer`     | files              | read-only; drafts from notes and files              |
  | `general`    | everything         | the default                                         |

  A read-only specialist isn't given any tool that writes, runs commands or changes memory, and none gets a group the workspace turned off. Sub-agents can't delegate further.

  - **Team notes:** while a request runs, the agent and its sub-agents share notes (`post_note`, `read_notes`): a researcher posts what it found, and the writer reads it, without everything passing through the main agent's context. They start empty with each message and aren't saved.
  - **At the same time:** several `delegate_task` calls in one step run in parallel, up to **Parallel sub-agents** in Settings → Agent (1–8, default 3); the rest wait their turn. They split the message's remaining token budget, so parallel work can't overspend it. Their approval prompts and questions take turns, so you answer one at a time.
  - **In the chat:** each `delegate_task` step shows its specialist and label with the sub-agent's own tool calls under it, and a sub-agent's approval card names it ("Coder “Fix tests” wants to run…"). In the CLI its lines read `[coder · Fix tests] run_command`.
  - **Your own specialists:** open the **Agents** tab (next to Skills, under the side panel) and click **New specialist**: a name, when to use it, which tool groups it gets, read-only, which model, and its role. Click a built-in to start from a copy of it. It is used from the next message. A file in the agents folder that can't be used shows at the top of the tab with why (no description, an unknown tool group, a bad file name, a link…), with **Fix**, which rewrites it from the form, and delete. Each one is kept as `.code-ai/<workspace>/agents/<name>.md`, so you can also write the file yourself:

    ```markdown
    ---
    description: Checking code for security problems: injection, secrets, unsafe input.
    tools: files, web
    read_only: true
    model: review
    ---

    You are the team's security auditor. Read the code you're pointed at, list each problem
    with file, line and a fix, and post the serious ones as team notes.
    ```

    `description` is required (it's how the agent picks). `tools` lists tool groups (files, commands, web, memory, plans; left out: all). `read_only` defaults to false. `model` is `subagent` (the default, Settings → Agent → Sub-agent model) or `review`. The text below the front matter is the specialist's role. A file named like a built-in (`coder.md`) replaces it. Files that break these rules, and links, are skipped.

  Sub-agents cost tokens: each one rereads what it needs. Turn them on for wide research and larger changes, and leave them off for chat.

- **Memory:** saved memories are added to the first message of every chat (and to the planning step), so the agent follows your preferences from its first reply. If you change them in the Memory panel mid-chat, the new list is sent with your next message. The agent updates an existing memory rather than saving a near-copy.

The API only listens on 127.0.0.1, so other devices on your network can't reach it, and it rejects requests addressed to any other host name and non-JSON writes. Keep it that way: the agent can write files.

## Project layout

An npm-workspaces monorepo. Apps are things you run; packages are libraries they share.

```
code-ai/
├── apps/
│   ├── api/                Express API (@app/api): /v1 REST + a server-sent-events run stream
│   │   └── src/            app.ts, index.ts, config/, middleware/, lib/, features/<feature>/
│   ├── web/                React + Vite + Tailwind chat UI (@app/web)
│   ├── cli/                terminal chat (@app/cli): --once mode, --new/--path, /plan /memory /workspace /folder /reset
│   └── desktop/            Electron desktop app (@app/desktop): runs the API and shows the web app in a window
├── packages/
│   ├── agent/              the agent (@app/agent), no HTTP and no database
│   │   ├── src/agent.ts    the agent loop: call model -> run tools -> repeat
│   │   ├── src/prompt.ts   system prompt: how the model chooses its next action
│   │   ├── src/planner.ts  planning step (direct vs plan) + plan state
│   │   ├── src/guardrails.ts  input checks, step/token budget, file sandbox, approval
│   │   ├── src/llm.ts      the only file that calls the model (OpenAI Chat Completions)
│   │   ├── src/config.ts   settings, read from .env by the apps
│   │   ├── src/logger.ts   console output + JSONL logs
│   │   ├── src/memory/     short-term.ts (conversation), long-term.ts (saved facts)
│   │   ├── src/tools/      one file per tool + index.ts registry (files/: the file tools)
│   │   ├── test/           free tests with a fake model
│   │   └── evals/          behaviour checks against the real model
│   ├── db/                 storage (@app/db), files only: ~/.code-ai workspace list and settings, .code-ai folder data, Store, runInChat
│   ├── shared/             contracts shared by API, web and agent (@app/shared): types, Zod schemas
│   ├── tsconfig/           shared TypeScript configs
│   └── eslint-config/      shared ESLint config
└── docs/standards.md       coding standards
```

Dependencies point one way: `shared` <- `agent` <- `db` <- `api` and `cli`. `web` only uses `shared` and talks to the API over HTTP.

## Adding a tool

1. Create `packages/agent/src/tools/my-tool.ts` with `defineTool({ name, description, properties, run })`. Write the description to say _when_ the model should call it. That text is how the model decides.
2. Register it in `packages/agent/src/tools/index.ts`.
3. Set `needsApproval: true` if it changes anything outside the agent (writes files, sends messages, spends money). Arguments the model may leave out go in `optional`.
4. Add an offline test in `packages/agent/test/` and an eval case in `packages/agent/evals/cases.json` that checks the model picks it.

## Choosing models

Models are set up in the app, under **Settings → Models** (the "Models" link in the top bar's connection menu, or "Manage models" in the chat's model picker). They are app-wide: every workspace and the terminal chat use the same list. Add as many as you like; each needs:

| Field      | What to enter                                                                  |
| ---------- | ------------------------------------------------------------------------------ |
| Server     | the OpenAI-compatible base URL (presets for the servers below); empty = OpenAI |
| Model name | exactly as the server lists it, e.g. `gpt-4.1` or `llama3.1:8b`                |
| API key    | for hosted servers; not needed for Ollama or LM Studio                         |
| Reasoning  | on for reasoning models, so the chat offers a Low / Medium / High effort       |

| Server            | Base URL                         | API key     |
| ----------------- | -------------------------------- | ----------- |
| OpenAI            | leave empty                      | your key    |
| Ollama (local)    | `http://localhost:11434/v1`      | leave empty |
| LM Studio (local) | `http://localhost:1234/v1`       | leave empty |
| OpenRouter        | `https://openrouter.ai/api/v1`   | your key    |
| Groq              | `https://api.groq.com/openai/v1` | your key    |

In the chat, the message box has a model picker and, for reasoning models, an effort picker; the choice is remembered in the browser. One model is the **default**: it is used when none is picked and by the CLI (`npm run cli -- --model NAME` picks another; `/models`, `/model NAME` and `/effort low|medium|high|off` switch while chatting).

The model **must support tool (function) calling**, or the agent can only chat and can't use tools or plans. API keys are stored in `~/.code-ai/models.json` (readable only by you) and are never sent back to the browser; the UI only shows whether a key is saved.

For web search, set **Settings → Agent → SearXNG URL** (default `http://localhost:8080`) to a SearXNG instance with the JSON format turned on (`search.formats: [html, json]` in its `settings.yml`).

## Agent settings

Everything about how the agent behaves is set in the app under **Settings → Agent**, saved in `~/.code-ai/agent-settings.json` and applied from the next message (no restart): tool approvals (ask / run without asking / refuse), planning on or off, max model calls, the token budget and longest message per prompt, sub-agents (on/off, their model, how many work at once), answer review, the SearXNG URL and the console log level. The CLI reads the same settings. `.env` is optional and keeps only server options: `PORT`, `CORS_ORIGIN`, `LOG_LEVEL` (HTTP logs) and `AGENT_LOG_DIR`, plus the `EVAL_*` values for evals.

Evals (`npm run eval`) don't read the app's saved models, so they take their model from `EVAL_MODEL`, `EVAL_BASE_URL` and `EVAL_API_KEY` in `.env`.

## Design notes

- **Chat Completions API.** This is the format almost every OpenAI-compatible server supports. Tools are sent as `function` tools, and results go back as `tool` messages matched by `tool_call_id`.
- **Arguments are checked in code.** Not every server enforces tool schemas, and smaller models make mistakes, so `packages/agent/src/tools/define.ts` validates arguments. Errors go back to the model so it can fix the call.
- **Optional settings are sent only when set.** A model's max tokens and the reasoning effort are left out of requests unless set, because some servers or models reject them. The effort is only sent for models marked as reasoning models.
- **Conversation history is append-only,** so servers that cache repeated prompt prefixes can reuse them. Start a new chat to start over.
- **Attached images are stored by reference.** A chat's saved messages hold the attachment id; the image is read and sent as an `image_url` part only when the model is called, so `messages.jsonl` stays small.
- **Workspace instructions go in the system prompt.** They stay the same for every request in a workspace, so caching still works.
