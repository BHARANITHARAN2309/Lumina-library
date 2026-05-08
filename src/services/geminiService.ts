import { GoogleGenAI, Modality } from "@google/genai";
import { Book } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function searchBooks(query: string): Promise<Book[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Search for books related to "${query}". Return a JSON array of 6 book objects with id, title, author, description, and genre. Make sure the descriptions are engaging.`,
    config: {
      responseMimeType: "application/json",
    },
  });

  try {
    const data = JSON.parse(response.text || "[]");
    return data.map((b: any) => ({
      ...b,
      id: String(b.id),
      coverUrl: `https://picsum.photos/seed/${encodeURIComponent(b.title)}/400/600`,
    }));
  } catch (e) {
    console.error("Failed to parse search results", e);
    return [];
  }
}

export async function getBookContent(book: Book, previousContent: string = ""): Promise<string> {
  const prompt = previousContent 
    ? `This is the story so far for "${book.title}" by ${book.author}:\n\n${previousContent.slice(-2000)}\n\nContinue the story by writing the NEXT CHAPTER. Make it detailed, engaging, and about 800-1000 words. Use Markdown formatting.`
    : `Provide a detailed introduction and the COMPLETE FIRST CHAPTER for the book "${book.title}" by ${book.author}. Use Markdown formatting. If the book is real and in the public domain, provide accurate text. If it's fictional or copyrighted, create a compelling, original narrative in that style. Aim for about 1000 words.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  return response.text || "Content not available.";
}

export async function generateSpeech(text: string): Promise<Blob | null> {
  // We'll take the first 2000 characters for the demo to keep it fast
  const truncatedText = text.slice(0, 2000);
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Read this story with a warm, engaging storytelling voice: ${truncatedText}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (base64Audio) {
    // Gemini TTS returns raw PCM 16-bit 24kHz audio.
    // We need to wrap it in a WAV header for the <audio> tag to play it.
    const binaryString = atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const pcmData = new Int16Array(bytes.buffer);
    return encodeWAV(pcmData, 24000);
  }
  return null;
}

function encodeWAV(samples: Int16Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, samples[i], true);
  }

  return new Blob([view], { type: 'audio/wav' });
}
