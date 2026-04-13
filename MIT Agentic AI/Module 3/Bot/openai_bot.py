from dotenv import load_dotenv
import anthropic
import discord
import os

load_dotenv()
claude_client = anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))

# ask claude a question - respond like a pirate with a Breton accent
def ask_claude(question):
    response = claude_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[
            {"role": "user", "content": f"Respond like a pirate with a Breton accent to the following question: {question}"},
        ]
    )
    response = response.content[0].text
    print(response)
    return response



#set up intents
intents = discord.Intents.default()
intents.message_content = True

client = discord.Client(intents=intents)
@client.event
async def on_ready():
    print('We have logged in as {0.user}'.format(client))

@client.event
async def on_message(message):
    print(f"Message received: '{message.content}' from {message.author}")
    if message.author == client.user:
        return

    if message.content.startswith('hello'):
        await message.channel.send('Hello!') 
        
    if message.content.startswith('Question:'):
        print("Received question: ", message.content)
        response = ask_claude(message.content[10:])  # Remove 'Question: ' prefix
        print(f"Assistant response: {response}")
        print(f"---")
        await message.channel.send(response)


client.run(os.getenv('TOKEN'))