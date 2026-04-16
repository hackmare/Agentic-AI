# Copyright (c) 2026 Morgane Oger <m.oger@roitsystems.ca>
# Licensed under the MIT License. See LICENSE file in the project root.

# This Discord bot uses Anthropic's Claude AI (NOT OpenAI) to answer questions.
# Claude is accessed via the Anthropic SDK (pip install anthropic).
# The bot listens for messages in Discord and responds using Claude.

from dotenv import load_dotenv  # loads environment variables from .env file
import anthropic                 # Anthropic SDK for Claude API calls
import discord                   # Discord SDK for bot interaction
import os

# Load environment variables from .env (ANTHROPIC_API_KEY and TOKEN)
load_dotenv()

# Initialize the Claude client using the Anthropic API key from .env
# This uses Claude — NOT OpenAI's GPT models
claude_client = anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))

def ask_claude(question):
    # Send the question to Claude (claude-haiku) and get a response.
    # Claude is instructed to respond like a pirate with a Breton accent.
    response = claude_client.messages.create(
        model="claude-haiku-4-5-20251001",  # Claude Haiku — fast and lightweight
        max_tokens=1024,
        messages=[
            {"role": "user", "content": f"Respond like a pirate with a Breton accent and a clear bias for all things Breton to the following question: {question}. Answer in Breton, then in French, then in English. Make fun of Parisians or France in the answer."},
        ]
    )
    # Extract the text content from Claude's response
    response = response.content[0].text
    print(response)
    return response


# Set up Discord intents — message_content is required to read message text
intents = discord.Intents.default()
intents.message_content = True

# Create the Discord client
client = discord.Client(intents=intents)

@client.event
async def on_ready():
    # Fired when the bot successfully connects to Discord
    print('We have logged in as {0.user}'.format(client))

@client.event
async def on_message(message):
    # Fired for every message the bot can see in its channels
    print(f"Message received: '{message.content}' from {message.author}")

    # Ignore messages sent by the bot itself to avoid infinite loops
    if message.author == client.user:
        return

    # Respond to greetings
    if message.content.startswith('hello'):
        await message.channel.send('Hello!')

    # Send messages starting with 'Question:' to Claude for an AI response
    # Example: "Question: What is the capital of France?"
    if message.content.startswith('Question:'):
        print("Received question: ", message.content)
        question = message.content[10:]  # Strip the 'Question: ' prefix (10 chars)
        response = ask_claude(question)  # Ask Claude (Anthropic) — not OpenAI
        print(f"Claude response: {response}")
        print(f"---")
        await message.channel.send(response)


# Start the bot using the Discord token from .env
client.run(os.getenv('TOKEN'))
