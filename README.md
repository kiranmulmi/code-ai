# Code AI

Code AI is a personal AI assistant that runs on your own computer. You chat with it in your web browser, and it can answer questions, search the web, work with files in a folder you choose, and handle bigger tasks step by step.

It works with many AI services: **OpenAI** (ChatGPT's company), **OpenRouter**, **Groq**, or free AI models that run on your own computer with **Ollama** or **LM Studio**.

Your chats and settings are saved on your computer. Your messages only go to the AI service you choose (or nowhere, if you run the AI on your own computer).

---

## What you need

1. **A computer** running Windows, macOS or Linux.
2. **Node.js, version 22.9 or newer.** This is free software that runs the app.
   - Download it from [nodejs.org](https://nodejs.org) (pick the "LTS" version) and install it like any other program.
   - To check it worked, open a terminal (see below) and type `node -v`. You should see a number like `v22.x` or higher.
3. **An AI model to talk to.** Pick one:
   - **Paid and easy:** an API key from [OpenAI](https://platform.openai.com/api-keys) or [OpenRouter](https://openrouter.ai/keys). An API key is like a password that lets the app use their AI. These services charge a small amount per use.
   - **Free and private:** install [Ollama](https://ollama.com), then download a model by typing `ollama pull llama3.1:8b` in a terminal. This runs the AI on your own computer (a fairly modern computer is recommended).

> **How to open a terminal:**
>
> - **Windows:** press the Start button, type `PowerShell`, and open it.
> - **macOS:** press `Cmd + Space`, type `Terminal`, and press Enter.
> - **Linux:** look for "Terminal" in your apps.

---

## Setting it up (one time)

**Step 1. Get the project files.**
Download this project as a ZIP (on GitHub: the green **Code** button, then **Download ZIP**) and unzip it somewhere easy to find, like your Documents folder. If you use Git, you can clone it instead.

**Step 2. Open a terminal inside the project folder.**
Type `cd ` (with a space after it), drag the project folder into the terminal window, and press Enter.

**Step 3. Install what the app needs.**
Type this and press Enter. It may take a few minutes the first time.

```bash
npm install
```

That's the setup done.

---

## Starting the app

In the terminal, inside the project folder, type:

```bash
npm start
```

Wait until it says the server is running, then open your web browser and go to:

**http://localhost:4000**

Keep the terminal window open while you use the app. To stop the app, click on the terminal and press `Ctrl + C`.

Next time, you only need to open a terminal in the project folder and run `npm start` again.

---

## Connecting your AI model (first time only)

1. In the app, open **Settings**, then **Models**.
2. Add a model and fill in the boxes using the table below.
3. Save it, go back to the chat, and say hello.

| If you use...        | Address (Base URL)               | API key        | Example model name   |
| -------------------- | -------------------------------- | -------------- | -------------------- |
| OpenAI               | leave empty                      | paste your key | `gpt-4o-mini`        |
| OpenRouter           | `https://openrouter.ai/api/v1`   | paste your key | see their website    |
| Groq                 | `https://api.groq.com/openai/v1` | paste your key | see their website    |
| Ollama (free, local) | `http://localhost:11434/v1`      | leave empty    | `llama3.1:8b`        |
| LM Studio (local)    | `http://localhost:1234/v1`       | leave empty    | the model you loaded |

**Tip:** choose a model that supports "tool calling" (most modern ones do). Without it, the assistant can only chat and can't use its tools.

Your API key is saved only on your computer and is never shown in the browser.

---

## Other ways to use it

- **Chat in the terminal instead of the browser:** `npm run cli`
- **Open it as a desktop app in its own window:** `npm run desktop`

All of these share the same chats and settings.

---

## Where your data is kept

Everything is saved as normal files on your computer, in a folder called `.code-ai` inside your home folder. There is no database to install. To start completely fresh, you can delete that folder (this removes your chats, models and settings).

---

## Common problems

| Problem                                                   | What to try                                                                                                                                   |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm` or `node` is "not recognized" / "command not found" | Node.js isn't installed, or the terminal was open before you installed it. Install Node.js, then close and reopen the terminal.               |
| The page at http://localhost:4000 won't load              | Make sure `npm start` is still running in the terminal and finished starting.                                                                 |
| "Port already in use"                                     | The app is already running in another terminal. Close that one first.                                                                         |
| The assistant doesn't reply or shows an error             | Check the model settings: the API key, the address and the model name must be exactly right. For Ollama, make sure the Ollama app is running. |
| The assistant chats but never uses tools                  | Pick a model that supports tool calling.                                                                                                      |

---

## For developers

Developer commands: `npm run dev` (live-reloading API and web app), `npm test` (offline tests), `npm run lint`, `npm run typecheck`. Optional server options (port, logs, sign-in) are described in `.env.example`. Project conventions are in `CLAUDE.md` and `docs/standards.md`.
