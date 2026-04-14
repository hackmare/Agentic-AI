# Module 3 — Discord Bots

Two Discord bots built as part of the MIT Agentic AI course.

---

## discord_only.py

A simple Discord bot with no AI integration. Responds to greetings with a hardcoded reply.

**Features:**
- Replies `Hello!` to any message starting with `hello`

**Setup:**
1. Create a `.env` file in this directory:
   ```
   TOKEN=your_discord_bot_token
   ```
2. Install dependencies:
   ```
   pip install discord.py python-dotenv
   ```
3. Run:
   ```
   python3 discord_only.py
   ```

---

## openai_bot.py

A Discord bot powered by **Anthropic's Claude AI** (claude-haiku). Answers questions in Discord using Claude — despite the filename, this bot does **not** use OpenAI.

**Features:**
- Replies `Hello!` to any message starting with `hello`
- Sends messages starting with `Question:` to Claude and returns the AI response
  - Example: `Question: What is the capital of France?`
- Claude is prompted to respond like a pirate with a Breton accent

**Setup:**
1. Create a `.env` file in this directory:
   ```
   TOKEN=your_discord_bot_token
   ANTHROPIC_API_KEY=your_anthropic_api_key
   ```
2. Install dependencies:
   ```
   pip install discord.py python-dotenv anthropic
   ```
3. In the [Discord Developer Portal](https://discord.com/developers/applications), enable **Message Content Intent** under your bot's Privileged Gateway Intents.
4. Run:
   ```
   python3 openai_bot.py
   ```

---

## License

Copyright (c) 2026 Morgane Oger <m.oger@roitsystems.ca> — MIT License. See [LICENSE](../../../LICENSE).
