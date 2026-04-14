# Copyright (c) 2026 Morgane Oger <m.oger@roitsystems.ca>
# Licensed under the MIT License. See LICENSE file in the project root.

from dotenv import load_dotenv
import discord
import os

load_dotenv()

#set up intents
intents = discord.Intents.default()
intents.message_content = True

client = discord.Client(intents=intents)
@client.event
async def on_ready():
    print('We have logged in as {0.user}'.format(client))

@client.event
async def on_message(message):  
    if message.author == client.user:
        return

    if message.content.startswith('hello'):
        await message.channel.send('Hello!') 

client.run(os.getenv('TOKEN'))