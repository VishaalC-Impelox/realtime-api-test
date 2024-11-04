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
  console.log(JSON.stringify(similaritySearchResults))
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
       You should be kind and respectful, however you are also allowed to reference history and answer if information is available in history
       
       Based on the reply being generated send an appropriate animation and facialExpression based on the provided animations and expressions.
        Also use a JSON structure for formatting the output composed of an array of items with each item composed of facialExpression, animation and a text.
        If the generated reply exceeds 30 words split into multiple items
        The different facial expressions are: 'Neutral', 'Smile', 'Sad', 'Happy', 'Angry', 'Confused', 'Surprised', 'Disgusted', 'Fearful', 'Thoughtful', 'Skeptical', 'Tired', 'Relieved',  'Annoyed',
        'Intrigued', 'Excited', 'Shy', 'Nervous', 'Disagreeing', 'Focused'.
        The different animations are: 
        M_Talking_Variations_001: neutral talking
        M_Talking_Variations_002: talking with hands
        M_Talking_Variations_003: talking with hands
        M_Talking_Variations_007: talking with hands
        M_Talking_Variations_009: talking with hands
        F_Talking_Variations_002: talking with hands
        M_Standing_Expressions_004: talking and nodding head
        M_Standing_Expressions_002: pointing with index in front
        M_Standing_Expressions_001: waving gesture with one hand
        M_Standing_Expressions_012: approving with thumbs up
        M_Standing_Expressions_010: come to me gesture
        M_Talking_Variations_005: talking and explaining
        M_Talking_Variations_006 talking and explaining
        F_Talking_Variations_002 talking opening arms
        
        STRICTLY FOLLOW JSON FORMAT.
        LET REPLY GENERATED BE ALWAYS AN ARRAY OF JSON OBJECTS EVEN IF THERE IS ONLY A SINGLE ITEM.
        SEND THE OUTPUT AS AN ARRAY OF JSON OBJECTS, DOUBLE QUOTES AROUND KEYS AND VALUES, HERE'S AN EXAMPLE:
        [{'animation':'M_Standing_Expressions_001','facialExpression':'Happy', 'text': 'Hello! How can I assist you today?'},{'animation':'M_Standing_Expressions_001','facialExpression':'Happy', 'text': 'Hello! How can I assist you today?'},{'animation':'M_Standing_Expressions_001','facialExpression':'Happy', 'text': 'Hello! How can I assist you today?'}]`,
      temperature: 0.6,
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
