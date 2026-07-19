import { GoogleGenAI, Type } from "@google/genai";
import { Verdict } from "../types";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

if (!API_KEY || API_KEY.startsWith('your_')) {
  console.warn('Gemini API key not configured. AI analysis will use fallback mode. Update VITE_GEMINI_API_KEY in your .env file.');
}

const ai = new GoogleGenAI({ 
  apiKey: API_KEY 
});

// ─── Analysis Result Types ─────────────────────────────────────────────────

export type DecisionType = 'LBW' | 'Run-out' | 'Edge Detection';

export interface LBWDetails {
  pitching: 'In Line' | 'Outside Off' | 'Outside Leg';
  impact: 'In Line' | 'Outside Off' | 'Outside Leg';
  wickets: 'Hitting' | 'Missing' | 'Clipping';
  ball_tracking_confidence: number;
}

export interface RunOutDetails {
  batsman_in_crease: boolean;
  stumps_broken: boolean;
  direct_hit: boolean;
  margin_cm: number;
}

export interface EdgeDetails {
  bat_involved: boolean;
  pad_involved: boolean;
  spike_detected: boolean;
  hotspot_detected: boolean;
  sound_anomaly: boolean;
}

export interface AnalysisResult {
  decision_type: string;
  is_out: boolean;
  confidence: number;
  reasoning: string;
  lbw_details: LBWDetails | null;
  runout_details: RunOutDetails | null;
  edge_details: EdgeDetails | null;
}

// ─── Decision-Type-Specific Prompts ─────────────────────────────────────────

function getLBWPrompt(): string {
  return `You are an expert cricket DRS (Decision Review System) umpire AI. Analyze these video frames of a cricket delivery for an LBW (Leg Before Wicket) appeal.

CRITICAL ANALYSIS STEPS:
1. **PITCHING**: Where did the ball pitch? Was it "In Line" with the stumps, "Outside Off", or "Outside Leg"?  
   - If pitching is "Outside Leg", the batsman is NOT OUT regardless of other factors.
2. **IMPACT**: Where did the ball hit the pad? Was the impact "In Line" with the stumps, "Outside Off", or "Outside Leg"?  
   - If impact is "Outside Off" AND the batsman was playing a shot, the batsman is NOT OUT.
3. **WICKETS**: Track the ball's projected path after impact. Would it have gone on to hit the stumps ("Hitting"), miss them ("Missing"), or just clip the bails ("Clipping")?  
   - "Clipping" means the ball is only marginally hitting — this should be UMPIRE'S CALL.
4. **BALL TRACKING CONFIDENCE**: How confident are you in your ball tracking projection (0-100)?

DECISION RULES (follow ICC DRS rules strictly):
- OUT: Pitching "In Line" or "Outside Off", Impact "In Line", Wickets "Hitting", confidence > 50
- UMPIRE'S CALL: Wickets is "Clipping" OR Impact is borderline OR confidence is between 40-60
- NOT OUT: Pitching "Outside Leg" OR Impact "Outside Off" (if shot played) OR Wickets "Missing"

Be precise and realistic. If the frames are unclear or don't show a cricket delivery, set confidence very low.`;
}

function getRunOutPrompt(): string {
  return `You are an expert cricket DRS (Decision Review System) umpire AI. Analyze these video frames for a Run-out appeal.

CRITICAL ANALYSIS STEPS:
1. **BATSMAN POSITION**: Is the batsman's bat or any part of the body grounded behind the crease line when the stumps are broken?
2. **STUMPS BROKEN**: Are the stumps clearly disturbed/bails dislodged at the moment of assessment?
3. **DIRECT HIT**: Was this a direct hit from a fielder, or was the wicket-keeper/fielder collecting and then breaking the stumps?
4. **MARGIN**: Estimate the margin in centimeters — how close was the decision? 
   - If margin is < 5cm, this should be UMPIRE'S CALL (too close to call definitively).

DECISION RULES:
- OUT: Batsman is NOT grounded behind the crease when stumps are broken, confidence > 50
- UMPIRE'S CALL: Margin is < 5cm (too close to call) OR confidence is between 40-60  
- NOT OUT: Batsman is safely grounded behind the crease, or stumps are not broken

Be precise and realistic. If the frames are unclear, set confidence very low.`;
}

function getEdgeDetectionPrompt(): string {
  return `You are an expert cricket DRS (Decision Review System) umpire AI. Analyze these video frames for a caught-behind / edge detection appeal.

CRITICAL ANALYSIS STEPS:
1. **BAT INVOLVED**: Does the ball make contact with the bat? Look for deflection, deviation in ball path, or visible contact.
2. **PAD INVOLVED**: Does the ball hit the pad? Could this be bat-pad or pad-bat?
3. **SPIKE DETECTED**: Would UltraEdge/Snickometer show a spike at the moment the ball passes the bat? Look for any visual evidence of contact.
4. **HOTSPOT DETECTED**: Would Hotspot technology show a heat mark on the bat edge?
5. **SOUND ANOMALY**: Is there any visual evidence suggesting a noise/click at the critical moment?

DECISION RULES:
- OUT: Clear bat contact detected (spike + visual evidence), ball carried to fielder/keeper, confidence > 50
- UMPIRE'S CALL: Inconclusive spike, bat very close to ball but contact uncertain, confidence 40-60
- NOT OUT: No bat contact, ball hits pad only, or ball passes bat cleanly

Be precise. Look for the finest edges. If frames are unclear, set confidence very low.`;
}

// ─── Response Schemas ───────────────────────────────────────────────────────

function getLBWSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      is_out: { type: Type.BOOLEAN },
      confidence: { type: Type.NUMBER },
      reasoning: { type: Type.STRING },
      pitching: { type: Type.STRING, enum: ["In Line", "Outside Off", "Outside Leg"] },
      impact: { type: Type.STRING, enum: ["In Line", "Outside Off", "Outside Leg"] },
      wickets: { type: Type.STRING, enum: ["Hitting", "Missing", "Clipping"] },
      ball_tracking_confidence: { type: Type.NUMBER }
    },
    required: ["is_out", "confidence", "reasoning", "pitching", "impact", "wickets", "ball_tracking_confidence"]
  };
}

function getRunOutSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      is_out: { type: Type.BOOLEAN },
      confidence: { type: Type.NUMBER },
      reasoning: { type: Type.STRING },
      batsman_in_crease: { type: Type.BOOLEAN },
      stumps_broken: { type: Type.BOOLEAN },
      direct_hit: { type: Type.BOOLEAN },
      margin_cm: { type: Type.NUMBER }
    },
    required: ["is_out", "confidence", "reasoning", "batsman_in_crease", "stumps_broken", "direct_hit", "margin_cm"]
  };
}

function getEdgeSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      is_out: { type: Type.BOOLEAN },
      confidence: { type: Type.NUMBER },
      reasoning: { type: Type.STRING },
      bat_involved: { type: Type.BOOLEAN },
      pad_involved: { type: Type.BOOLEAN },
      spike_detected: { type: Type.BOOLEAN },
      hotspot_detected: { type: Type.BOOLEAN },
      sound_anomaly: { type: Type.BOOLEAN }
    },
    required: ["is_out", "confidence", "reasoning", "bat_involved", "pad_involved", "spike_detected", "hotspot_detected", "sound_anomaly"]
  };
}

// ─── Verdict Determination ──────────────────────────────────────────────────

/**
 * Determines the final DRS verdict using ICC-style confidence thresholds.
 * - Umpire's Call zone: confidence 40-60 OR borderline tracking values
 */
function determineVerdict(
  rawResult: any,
  decisionType: DecisionType
): { verdict: Verdict; confidence: number } {
  const confidence = Math.max(0, Math.min(100, Math.round(rawResult.confidence)));
  
  // If AI confidence is very low, it's unclear footage — defer to umpire
  if (confidence < 30) {
    return { verdict: Verdict.UMPIRES_CALL, confidence };
  }

  if (decisionType === 'LBW') {
    // ICC LBW rules
    if (rawResult.pitching === 'Outside Leg') {
      return { verdict: Verdict.NOT_OUT, confidence };
    }
    if (rawResult.wickets === 'Missing') {
      return { verdict: Verdict.NOT_OUT, confidence };
    }
    if (rawResult.wickets === 'Clipping') {
      return { verdict: Verdict.UMPIRES_CALL, confidence };
    }
    // Borderline confidence = Umpire's Call
    if (confidence >= 40 && confidence <= 60) {
      return { verdict: Verdict.UMPIRES_CALL, confidence };
    }
    return {
      verdict: rawResult.is_out ? Verdict.OUT : Verdict.NOT_OUT,
      confidence
    };
  }

  if (decisionType === 'Run-out') {
    // Very tight margin = Umpire's Call
    if (rawResult.margin_cm !== undefined && rawResult.margin_cm < 5 && rawResult.margin_cm > 0) {
      return { verdict: Verdict.UMPIRES_CALL, confidence };
    }
    if (confidence >= 40 && confidence <= 60) {
      return { verdict: Verdict.UMPIRES_CALL, confidence };
    }
    return {
      verdict: rawResult.is_out ? Verdict.OUT : Verdict.NOT_OUT,
      confidence
    };
  }

  if (decisionType === 'Edge Detection') {
    // Inconclusive spike = Umpire's Call
    if (rawResult.spike_detected && !rawResult.hotspot_detected && confidence < 65) {
      return { verdict: Verdict.UMPIRES_CALL, confidence };
    }
    if (confidence >= 40 && confidence <= 60) {
      return { verdict: Verdict.UMPIRES_CALL, confidence };
    }
    return {
      verdict: rawResult.is_out ? Verdict.OUT : Verdict.NOT_OUT,
      confidence
    };
  }

  // Fallback
  return {
    verdict: rawResult.is_out ? Verdict.OUT : Verdict.NOT_OUT,
    confidence
  };
}

// ─── Frame Extraction ───────────────────────────────────────────────────────

/**
 * Extracts frames from a video file using a hidden canvas.
 * Uses 8 frames by default for better coverage of the delivery.
 */
export async function extractFrames(videoFile: File, frameCount: number = 8): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const frames: string[] = [];
    
    video.src = URL.createObjectURL(videoFile);
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    
    video.onloadedmetadata = async () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const duration = video.duration;
      const interval = duration / (frameCount + 1);
      
      try {
        for (let i = 1; i <= frameCount; i++) {
          video.currentTime = i * interval;
          await new Promise<void>((r, j) => {
            const timeout = setTimeout(() => j(new Error("Frame seek timeout")), 3000);
            video.onseeked = () => {
              clearTimeout(timeout);
              r();
            };
          });
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
          }
        }
        URL.revokeObjectURL(video.src);
        resolve(frames);
      } catch (err) {
        URL.revokeObjectURL(video.src);
        reject(err);
      }
    };
    
    // Global timeout
    setTimeout(() => reject(new Error("Video loading timeout")), 15000);
    
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Video loading error"));
    };
  });
}

// ─── Main Analysis Function ─────────────────────────────────────────────────

/**
 * Sends frames to Gemini for decision-type-specific DRS analysis.
 */
export async function analyzeVideoWithGemini(
  frames: string[],
  decisionType: DecisionType
): Promise<AnalysisResult> {
  // Select prompt and schema based on decision type
  let prompt: string;
  let responseSchema: any;

  switch (decisionType) {
    case 'LBW':
      prompt = getLBWPrompt();
      responseSchema = getLBWSchema();
      break;
    case 'Run-out':
      prompt = getRunOutPrompt();
      responseSchema = getRunOutSchema();
      break;
    case 'Edge Detection':
      prompt = getEdgeDetectionPrompt();
      responseSchema = getEdgeSchema();
      break;
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
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
        responseSchema,
        temperature: 0.1, // Low temperature for more deterministic/accurate analysis
      }
    });

    if (!response.text) {
      throw new Error("No response from AI");
    }

    const rawResult = JSON.parse(response.text.trim());
    const { verdict, confidence } = determineVerdict(rawResult, decisionType);

    // Build structured result
    const result: AnalysisResult = {
      decision_type: decisionType,
      is_out: verdict === Verdict.OUT,
      confidence,
      reasoning: rawResult.reasoning || "Analysis completed.",
      lbw_details: null,
      runout_details: null,
      edge_details: null
    };

    if (decisionType === 'LBW') {
      result.lbw_details = {
        pitching: rawResult.pitching,
        impact: rawResult.impact,
        wickets: rawResult.wickets,
        ball_tracking_confidence: rawResult.ball_tracking_confidence
      };
    } else if (decisionType === 'Run-out') {
      result.runout_details = {
        batsman_in_crease: rawResult.batsman_in_crease,
        stumps_broken: rawResult.stumps_broken,
        direct_hit: rawResult.direct_hit,
        margin_cm: rawResult.margin_cm
      };
    } else if (decisionType === 'Edge Detection') {
      result.edge_details = {
        bat_involved: rawResult.bat_involved,
        pad_involved: rawResult.pad_involved,
        spike_detected: rawResult.spike_detected,
        hotspot_detected: rawResult.hotspot_detected,
        sound_anomaly: rawResult.sound_anomaly
      };
    }

    // Override verdict in result
    (result as any)._verdict = verdict;

    return result;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    // Fallback — return an inconclusive result
    return {
      decision_type: decisionType,
      is_out: false,
      confidence: 0,
      reasoning: "AI analysis failed. Reverting to field umpire's original decision.",
      lbw_details: decisionType === 'LBW' ? {
        pitching: 'In Line',
        impact: 'In Line',
        wickets: 'Missing',
        ball_tracking_confidence: 0
      } : null,
      runout_details: decisionType === 'Run-out' ? {
        batsman_in_crease: true,
        stumps_broken: false,
        direct_hit: false,
        margin_cm: 0
      } : null,
      edge_details: decisionType === 'Edge Detection' ? {
        bat_involved: false,
        pad_involved: false,
        spike_detected: false,
        hotspot_detected: false,
        sound_anomaly: false
      } : null
    };
  }
}

/**
 * Gets the final Verdict from an AnalysisResult, using DRS confidence rules.
 */
export function getVerdictFromResult(result: AnalysisResult, decisionType: DecisionType): Verdict {
  // Check if verdict was already determined during analysis
  if ((result as any)._verdict) {
    return (result as any)._verdict;
  }

  // Re-derive from data
  if (result.confidence < 30) {
    return Verdict.UMPIRES_CALL;
  }
  if (result.confidence >= 40 && result.confidence <= 60) {
    return Verdict.UMPIRES_CALL;
  }

  // Type-specific checks
  if (decisionType === 'LBW' && result.lbw_details) {
    if (result.lbw_details.pitching === 'Outside Leg') return Verdict.NOT_OUT;
    if (result.lbw_details.wickets === 'Missing') return Verdict.NOT_OUT;
    if (result.lbw_details.wickets === 'Clipping') return Verdict.UMPIRES_CALL;
  }

  if (decisionType === 'Run-out' && result.runout_details) {
    if (result.runout_details.margin_cm < 5 && result.runout_details.margin_cm > 0) {
      return Verdict.UMPIRES_CALL;
    }
  }

  if (decisionType === 'Edge Detection' && result.edge_details) {
    if (result.edge_details.spike_detected && !result.edge_details.hotspot_detected && result.confidence < 65) {
      return Verdict.UMPIRES_CALL;
    }
  }

  return result.is_out ? Verdict.OUT : Verdict.NOT_OUT;
}
