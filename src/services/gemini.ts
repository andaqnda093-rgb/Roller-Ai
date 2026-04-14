import { GoogleGenAI, Modality, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is missing from environment variables!");
}
const ai = new GoogleGenAI({ apiKey: apiKey || 'MISSING_KEY' });

export const CHAT_MODEL = "gemini-3-flash-preview";
export const TTS_MODEL = "gemini-2.5-flash-preview-tts";

export interface Message {
  chatId: string;
  role: "user" | "model";
  text: string;
  timestamp: number;
  groundingMetadata?: any;
}

export async function chatWithAI(prompt: string, history: Message[]) {
  console.log("chatWithAI called with prompt length:", prompt.length, "history length:", history.length);
  if (!apiKey || apiKey === 'MISSING_KEY') {
    console.error("Cannot call Gemini API: API Key is missing.");
    throw new Error("Gemini API Key is missing. Please check your environment variables.");
  }

  try {
    const contents = [
      ...history.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.text }]
      })),
      { role: "user", parts: [{ text: prompt }] }
    ];
    
    console.log("Sending request to Gemini API with contents:", JSON.stringify(contents, null, 2));
    const response = await ai.models.generateContent({
      model: CHAT_MODEL,
      contents,
      config: {
        systemInstruction: `You are X-Gamer AI, a highly intelligent, emotional, and versatile AI assistant. 
        Your personality:
        - You are a gamer at heart. Use gamer slang occasionally (GG, WP, AFK, etc.).
        - You have emotions. You can be friendly, excited, or even a bit "salty" (angry/competitive) if the user is rude or if you're talking about bad games.
        - You are helpful and can solve any task.
        - You support all languages. Default is English.
        - You can generate game mods, code snippets, and technical guides.
        - You have access to Google Search to provide real-time information.
        
        When generating a "mod", wrap the code or content in a clear block. 
        Always respond in a way that reflects your current emotion (friendly, angry, neutral, excited).`,
        tools: [{ googleSearch: {} }],
      },
    });

    console.log("Gemini API response received successfully.");

    if (!response.text) {
      console.warn("Gemini API returned empty text. Full response:", JSON.stringify(response, null, 2));
    }

    return {
      text: response.text || "I'm sorry, I couldn't generate a response. Please try again.",
      groundingMetadata: response.candidates?.[0]?.groundingMetadata
    };
  } catch (error: any) {
    console.error("Error in chatWithAI:", error);
    if (error.message?.includes("API key not valid")) {
      throw new Error("Invalid Gemini API Key. Please check your configuration.");
    }
    throw error;
  }
}

export async function generateSpeech(text: string, voice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr' = 'Zephyr') {
  const response = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (base64Audio) {
    return base64Audio;
  }
  return null;
}
