import { GoogleGenAI, Type } from "@google/genai";
import { Verdict } from "../types";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

if (!API_KEY || API_KEY.startsWith('your_')) {
  console.warn('Gemini API key not configured. AI analysis will use demo mode. Set VITE_GEMINI_API_KEY in your .env file.');
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

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
  return `You are an ICC-certified DRS umpire AI. Analyze these cricket video frames for an LBW (Leg Before Wicket) appeal and return a DECISIVE verdict.

ANALYSIS STEPS:
1. PITCHING: Where did the ball pitch? Pick one: "In Line" (between off and leg stump), "Outside Off" (outside off stump), or "Outside Leg" (outside leg stump).
2. IMPACT: Where did the ball strike the pad? Pick one: "In Line", "Outside Off", or "Outside Leg".
3. WICKETS: Project the ball's path — would it hit the stumps? Pick one: "Hitting" (clear impact on stumps), "Clipping" (just clipping the bails, very marginal), or "Missing" (going over, outside, or below stumps).
4. BALL TRACKING CONFIDENCE: Your confidence in the ball trajectory projection (0-100).

ICC RULES — apply strictly:
- If pitching = "Outside Leg" → is_out = false, reasoning must state "Pitched outside leg stump — NOT OUT under ICC DRS rule."
- If wickets = "Missing" → is_out = false, reasoning must state "Ball tracking shows the delivery missing the stumps — NOT OUT."
- If wickets = "Hitting" AND pitching = "In Line" or "Outside Off" AND impact = "In Line" → is_out = true.
- If wickets = "Clipping" → this is a borderline call, is_out = false (umpire's call scenario, original decision stands).
- If impact = "Outside Off" and batsman was playing a shot → is_out = false.

IMPORTANT: Be decisive. Set confidence based on clarity of evidence:
- 80-95: Very clear delivery, high confidence in tracking
- 60-79: Reasonably clear frames, moderate tracking confidence  
- 40-59: Partial evidence, lower tracking confidence but still make a call
- Do NOT set confidence < 30 unless the footage shows zero cricket content whatsoever.

Always return all required JSON fields. Make a firm decision.`;
}

function getRunOutPrompt(): string {
  return `You are an ICC-certified DRS umpire AI. Analyze these cricket video frames for a Run-out appeal and return a DECISIVE verdict.

ANALYSIS STEPS:
1. BATSMAN POSITION: Is any part of the batsman (bat, body) grounded behind the crease when stumps are broken? (batsman_in_crease = true means SAFE)
2. STUMPS BROKEN: Are the bails clearly dislodged? (stumps_broken = true is required for a run-out)
3. DIRECT HIT: Was this a direct throw, or did the keeper collect then break the stumps?
4. MARGIN: Estimate the gap in centimeters between the batsman's bat/body and the crease line at the moment of dismissal. Use 0 if batsman was clearly safe (in crease). Use 50+ if obviously short.

ICC RULES:
- If batsman_in_crease = true → is_out = false. Reasoning: "Bat/body was grounded behind the crease — NOT OUT."
- If stumps_broken = false → is_out = false. Reasoning: "Bails were not clearly dislodged — NOT OUT."
- If batsman_in_crease = false AND stumps_broken = true AND margin_cm >= 3 → is_out = true.
- If margin_cm < 3 AND margin_cm > 0 → extremely tight call, is_out based on your best visual assessment.

IMPORTANT: Be decisive. Set confidence 60-90 for clear footage, 40-60 for partial evidence. Do NOT refuse to make a call.

Always return all required JSON fields.`;
}

function getEdgeDetectionPrompt(): string {
  return `You are an ICC-certified DRS umpire AI analyzing frames for a caught-behind / edge detection appeal. Return a DECISIVE verdict.

ANALYSIS STEPS:
1. BAT INVOLVED: Does the ball make contact with the bat? Look for deviation in ball path, deflection, or visible contact near bat edge.
2. PAD INVOLVED: Does the ball first or only hit the pad?
3. SPIKE DETECTED: Would UltraEdge show a clear spike as the ball passes the bat? (true = spike visible/likely)
4. HOTSPOT DETECTED: Would Hotspot show a heat friction mark on the bat edge? (true = confirmed contact)
5. SOUND ANOMALY: Is there a visible click or sound anomaly in the frames at the moment of passing the bat?

ICC RULES:
- If spike_detected = true AND hotspot_detected = true → is_out = true (confirmed edge). "Clear edge confirmed by UltraEdge and Hotspot — OUT."
- If spike_detected = false AND hotspot_detected = false → is_out = false. "No evidence of bat contact — NOT OUT."
- If pad_involved = true AND bat_involved = false → is_out = false. "Ball struck pad only — NOT OUT."
- If spike_detected = true AND hotspot_detected = false → inconclusive, is_out based on visual bat contact evidence.
- If bat_involved = true AND ball carried to fielder → is_out = true.

IMPORTANT: Be decisive. Set confidence 70-90 for clear footage, 50-70 for partial evidence. Always make a firm call.

Always return all required JSON fields.`;
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
 * ICC-accurate verdict logic.
 * UMPIRE'S CALL is reserved ONLY for genuine cricket borderline situations:
 *   - LBW: ball clipping the bails (marginal hitting)
 *   - Run-out: margin < 3cm (too close for technology to determine)
 *   - Edge: spike without hotspot confirmation (inconclusive technology)
 * 
 * The old 40-60 confidence dead zone is REMOVED — it caused nearly everything
 * to become UMPIRE'S CALL regardless of what the AI actually detected.
 */
function determineVerdict(
  rawResult: any,
  decisionType: DecisionType
): { verdict: Verdict; confidence: number } {
  const confidence = Math.max(0, Math.min(100, Math.round(rawResult.confidence)));

  if (decisionType === 'LBW') {
    // Hard ICC rules first — these override everything
    if (rawResult.pitching === 'Outside Leg') {
      return { verdict: Verdict.NOT_OUT, confidence };
    }
    if (rawResult.wickets === 'Missing') {
      return { verdict: Verdict.NOT_OUT, confidence };
    }
    if (rawResult.impact === 'Outside Off') {
      return { verdict: Verdict.NOT_OUT, confidence };
    }
    // Genuine borderline: ball only clipping bails
    if (rawResult.wickets === 'Clipping') {
      return { verdict: Verdict.UMPIRES_CALL, confidence };
    }
    // Clear verdict from AI
    return { verdict: rawResult.is_out ? Verdict.OUT : Verdict.NOT_OUT, confidence };
  }

  if (decisionType === 'Run-out') {
    if (!rawResult.stumps_broken) {
      return { verdict: Verdict.NOT_OUT, confidence };
    }
    if (rawResult.batsman_in_crease) {
      return { verdict: Verdict.NOT_OUT, confidence };
    }
    // Margin < 3cm is genuinely too close for technology
    if (rawResult.margin_cm !== undefined && rawResult.margin_cm > 0 && rawResult.margin_cm < 3) {
      return { verdict: Verdict.UMPIRES_CALL, confidence };
    }
    return { verdict: rawResult.is_out ? Verdict.OUT : Verdict.NOT_OUT, confidence };
  }

  if (decisionType === 'Edge Detection') {
    if (!rawResult.bat_involved && !rawResult.spike_detected) {
      return { verdict: Verdict.NOT_OUT, confidence };
    }
    if (rawResult.pad_involved && !rawResult.bat_involved) {
      return { verdict: Verdict.NOT_OUT, confidence };
    }
    // Spike without hotspot = genuinely inconclusive technology
    if (rawResult.spike_detected && !rawResult.hotspot_detected) {
      return { verdict: Verdict.UMPIRES_CALL, confidence };
    }
    return { verdict: rawResult.is_out ? Verdict.OUT : Verdict.NOT_OUT, confidence };
  }

  return { verdict: rawResult.is_out ? Verdict.OUT : Verdict.NOT_OUT, confidence };
}

// ─── Frame Extraction ───────────────────────────────────────────────────────

/**
 * Extracts evenly-spaced frames from a video file using a hidden canvas.
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
                mimeType: "image/jpeg" as const
              }
            })),
            { text: prompt }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.15,
      }
    });

    if (!response.text) {
      throw new Error("No response from AI");
    }

    const rawResult = JSON.parse(response.text.trim());
    const { verdict, confidence } = determineVerdict(rawResult, decisionType);

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

    // Store the resolved verdict on the result
    (result as any)._verdict = verdict;

    return result;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    // Return a clear NOT OUT fallback (field umpire's original decision stands)
    return {
      decision_type: decisionType,
      is_out: false,
      confidence: 0,
      reasoning: "AI analysis failed. The field umpire's original decision stands.",
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
 * Gets the final Verdict from an AnalysisResult.
 */
export function getVerdictFromResult(result: AnalysisResult, decisionType: DecisionType): Verdict {
  if ((result as any)._verdict) {
    return (result as any)._verdict;
  }

  // Re-derive using the same ICC logic
  if (decisionType === 'LBW' && result.lbw_details) {
    if (result.lbw_details.pitching === 'Outside Leg') return Verdict.NOT_OUT;
    if (result.lbw_details.wickets === 'Missing') return Verdict.NOT_OUT;
    if (result.lbw_details.impact === 'Outside Off') return Verdict.NOT_OUT;
    if (result.lbw_details.wickets === 'Clipping') return Verdict.UMPIRES_CALL;
  }

  if (decisionType === 'Run-out' && result.runout_details) {
    if (!result.runout_details.stumps_broken) return Verdict.NOT_OUT;
    if (result.runout_details.batsman_in_crease) return Verdict.NOT_OUT;
    if (result.runout_details.margin_cm > 0 && result.runout_details.margin_cm < 3) {
      return Verdict.UMPIRES_CALL;
    }
  }

  if (decisionType === 'Edge Detection' && result.edge_details) {
    if (!result.edge_details.bat_involved && !result.edge_details.spike_detected) return Verdict.NOT_OUT;
    if (result.edge_details.spike_detected && !result.edge_details.hotspot_detected) return Verdict.UMPIRES_CALL;
  }

  return result.is_out ? Verdict.OUT : Verdict.NOT_OUT;
}
