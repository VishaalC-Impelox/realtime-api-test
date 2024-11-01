import * as dotenv from 'dotenv'
import WebSocket from 'ws'
import { question } from 'readline-sync'

dotenv.config()

const openAIKey = process.env.OPEN_AI_KEY
const url =
  'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01'

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
 * @description Function to initalize the conversation
 * conversation.item.create is used for maintaining history as well as creating a conversation
 * response.create is used to create a response from api
 * @param {*} ws - WebSocket object
 */
const initializeConversation = (ws) => {
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
const sendMessage = (ws, userInput) => {
  const message = {
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: userInput }],
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
  }
}

run()
