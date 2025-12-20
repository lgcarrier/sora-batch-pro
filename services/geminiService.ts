
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const analyzeBatchMetadata = async (ids: string[]) => {
  if (!process.env.API_KEY) return null;

  const prompt = `
    I have a list of Sora video IDs: ${ids.join(', ')}.
    Generate a short, 2-3 word descriptive tag or "theme" for each ID. 
    Since the IDs themselves are opaque, use your internal knowledge if you recognize these specific viral Sora IDs, 
    otherwise generate a creative "AI Concept" name for them.
    
    Return the response as a valid JSON object where keys are the IDs and values are the descriptive tags.
    Example: {"s_123": "Cyberpunk Cityscape"}
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return null;
  }
};
