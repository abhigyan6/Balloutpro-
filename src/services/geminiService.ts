import { GoogleGenAI, Type } from "@google/genai";
import { Verdict } from "../types";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ 
  apiKey: API_KEY 
});

export interface AnalysisResult {
  out: boolean;
  lbw_possible: boolean;
  edge_detected: boolean;
  run_out: boolean;
  confidence: number;
  reasoning: string;
}

/**
 * Extracts frames from a video file using a hidden canvas.
 */
export async function extractFrames(videoFile: File, frameCount: number = 5): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const frames: string[] = [];
    
    video.src = URL.createObjectURL(videoFile);
    video.crossOrigin = "anonymous";
    video.muted = true;
    
    video.onloadedmetadata = async () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const duration = video.duration;
      const interval = duration / (frameCount + 1);
      
      try {
        for (let i = 1; i <= frameCount; i++) {
          video.currentTime = i * interval;
          await new Promise((r, j) => {
            const timeout = setTimeout(() => j(new Error("Frame seek timeout")), 2000);
            video.onseeked = () => {
              clearTimeout(timeout);
              r(null);
            };
          });
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
          }
        }
        URL.revokeObjectURL(video.src);
        resolve(frames);
      } catch (err) {
        URL.revokeObjectURL(video.src);
        reject(err);
      }
    };
    
    // Add a global timeout for the whole process
    setTimeout(() => reject(new Error("Video loading timeout")), 10000);
    
    video.onerror = (e) => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Video loading error"));
    };
  });
}

/**
 * Sends frames to Gemini for analysis
 */
export async function analyzeVideoWithGemini(frames: string[]): Promise<AnalysisResult> {
  const prompt = `Analyze this cricket delivery frame by frame. Tell me:
(a) Is the batsman out?
(b) LBW possible?
(c) Edge detected?
(d) Run-out happened?
(e) What is your confidence level (0-100)?
(f) Brief reasoning for decision.

Return the result as a JSON object with keys: out (boolean), lbw_possible (boolean), edge_detected (boolean), run_out (boolean), confidence (number), reasoning (string).`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            ...frames.map(f => ({
              inlineData: {
                data: f,
                mimeType: "image/jpeg"
              }
            })),
            { text: prompt }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            out: { type: Type.BOOLEAN },
            lbw_possible: { type: Type.BOOLEAN },
            edge_detected: { type: Type.BOOLEAN },
            run_out: { type: Type.BOOLEAN },
            confidence: { type: Type.NUMBER },
            reasoning: { type: Type.STRING }
          },
          required: ["out", "lbw_possible", "edge_detected", "run_out", "confidence", "reasoning"]
        }
      }
    });

    if (!response.text) {
      throw new Error("No response from AI");
    }

    return JSON.parse(response.text.trim());
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    // Fallback mock check as requested
    return {
      out: false,
      lbw_possible: true,
      edge_detected: false,
      run_out: false,
      confidence: 0,
      reasoning: "Analysis failed. Reverting to field umpire's call."
    };
  }
}
