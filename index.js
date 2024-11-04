import * as dotenv from 'dotenv'
import WebSocket from 'ws'
import { question } from 'readline-sync'
import { OpenAIEmbeddings } from '@langchain/openai'
import { PineconeStore } from '@langchain/pinecone'
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone'

dotenv.config()

const openAIKey = process.env.OPENAI_API_KEY
const indexName = process.env.PINECONE_INDEX
const url =
  'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01'
const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
})

const createPineconeIndex = async () => {
  const pinecone = new PineconeClient()
  const pineconeIndex = pinecone.Index(indexName)

  const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex,
    maxConcurrency: 5,
  })

  const document1 = {
    pageContent: 'The powerhouse of the cell is the mitochondria',
    metadata: { source: 'https://example.com' },
  }

  const document2 = {
    pageContent: 'Buildings are made out of brick',
    metadata: { source: 'https://example.com' },
  }

  const document3 = {
    pageContent: 'Mitochondria are made out of lipids',
    metadata: { source: 'https://example.com' },
  }

  const document4 = {
    pageContent: 'The 2024 Olympics are in Paris',
    metadata: { source: 'https://example.com' },
  }

  const documents = [document1, document2, document3, document4]

  await vectorStore.addDocuments(documents, { ids: ['1', '2', '3', '4'] })
}

/**
 * @description Function to initalize a web socket connection to openAI
 * @returns websocket object
 */
const connectToOpenAPI = () => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        Authorization: 'Bearer ' + openAIKey,
        'OpenAI-Beta': 'realtime=v1',
      },
    })

    ws.on('open', () => {
      console.log('Connected to OpenAI')
      resolve(ws)
    })

    ws.on('error', (err) => {
      console.error('Connection error:', err)
      reject(err)
    })
  })
}

/**
 * Uses langchain to retreive relevant data from the vector store
 * @param {*} message - input sent from user
 * @returns JSON string containing textual information
 */
const getRelevantData = async (message) => {
  const pinecone = new PineconeClient()
  const pineconeIndex = pinecone.Index(indexName)

  const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex,
    maxConcurrency: 5,
  })

  const similaritySearchResults = await vectorStore.similaritySearch(message, 1)
  return JSON.stringify(similaritySearchResults)
}

/**
 * @description Function to initalize the conversation
 * conversation.item.create is used for maintaining history as well as creating a conversation
 * response.create is used to create a response from api
 * @param {*} ws - WebSocket object
 */
const initializeConversation = (ws) => {
  const configMessage = {
    type: 'session.update',
    session: {
      modalities: ['text'],
      instructions: `You are a helpful assistant. You only reply based on the information that is provided to you, 
        anything that goes out of the scope of the information, you reply with "I don't know" or something along those lines.
       You should be kind and respectful, however you are also allowed to reference history and answer if information is available in history`,
      temperature: 0.8,
      max_response_output_tokens: 'inf',
    },
  }

  const initialMessage = {
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'Hello',
        },
      ],
    },
  }
  ws.send(JSON.stringify(configMessage))
  ws.send(JSON.stringify(initialMessage))
  ws.send(
    JSON.stringify({
      type: 'response.create',
      response: { modalities: ['text'] },
    })
  )
}

/**
 * @description Function to print incoming messages
 * @param {*} ws - WebSocket Object
 */
const handleIncomingMessages = (ws) => {
  ws.on('message', (message) => {
    const parsedMessage = JSON.parse(message.toString())
    if (parsedMessage?.response?.status === 'failed') {
      console.log('Something went wrong...Keep messaging')
    }
    if (parsedMessage?.type == 'response.done') {
      console.log('Usage Details:', parsedMessage?.response?.usage)
      console.log(
        'Received message:',
        parsedMessage?.response?.output?.[0]?.content
      )
      const userInput = question('Your message: ')
      sendMessage(ws, userInput)
    }
  })
}

/**
 * @description Function to send message and get response
 * @param {*} ws
 * @param {*} userInput
 */
const sendMessage = async (ws, userInput) => {
  const relevantData = await getRelevantData(userInput)
  const message = {
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: `${userInput}, "THIS TEXT ISN'T PROVIDED BY THE USER, DO NOT REFERENCE IT IN YOUR REPLIES. LIMIT YOUR KNOWLEDGE ONLY TO WHAT'S PRESENT IN THE FOLLOWING TEXT, 
          INFORMATION FOR GENERATING TEXT WHICH SHOULD NOT BE USED UNLESS USER EXPLICITLY ASKS SOMETHING RELATED TO IT: ${relevantData}"`,
        },
      ],
    },
  }
  ws.send(JSON.stringify(message))
  ws.send(
    JSON.stringify({
      type: 'response.create',
      response: { modalities: ['text'] },
    })
  )
}

const run = async () => {
  try {
    const ws = await connectToOpenAPI()
    initializeConversation(ws)
    handleIncomingMessages(ws)
  } catch (error) {
    console.error('Failed to run the chatbot:', error)
  } finally {
  }
}

run()
