/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import {
  Upload,
  RefreshCcw,
  Cpu,
  History,
  ChevronRight,
  Activity,
  Zap,
  CheckCircle2,
  Triangle,
  Radio,
  Clock,
  Layers,
  Award
} from 'lucide-react';
import { DecisionStatus, Verdict } from './types';
import { saveDecision, getRecentDecisions } from './firebase-config';
import { extractFrames, analyzeVideoWithGemini, getVerdictFromResult } from './services/geminiService';
import type { AnalysisResult } from './services/geminiService';

export default function App() {
  const [status, setStatus] = useState<DecisionStatus>(DecisionStatus.IDLE);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'LBW' | 'Run-out' | 'Edge Detection'>('LBW');
  const [progress, setProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [reasoning, setReasoning] = useState<string>('');
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceIndex, setCurrentDeviceIndex] = useState(0);
  const [view, setView] = useState<'HOME' | 'ANALYZER'>('HOME');
  const [matchInfo, setMatchInfo] = useState({
    teamA: '',
    teamB: '',
    location: 'Bhopal International Cricket Ground'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Camera stream attachment
  useEffect(() => {
    if (isLive && streamRef.current && videoRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.play().catch(e => console.error("Video play failed", e));
      }
    }
  }, [isLive]);

  // Global cleanup on unmount only
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const toggleLive = async () => {
    if (isLive) {
      setIsLive(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    } else {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("MediaDevices API not available.");
        }

        // Request basic video stream first for maximum compatibility
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        }).catch(() => navigator.mediaDevices.getUserMedia({ video: true }));

        streamRef.current = stream;
        setIsLive(true);
        setSelectedFile(null);

        // Enumerate devices in the background for the "Next Camera" feature
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputDevices = devices.filter(device => device.kind === 'videoinput');
        setVideoDevices(videoInputDevices);

        // Find the index of the current track's device
        const currentTrack = stream.getVideoTracks()[0];
        const currentSettings = currentTrack.getSettings();
        const activeIndex = videoInputDevices.findIndex(d => d.deviceId === currentSettings.deviceId);
        if (activeIndex !== -1) setCurrentDeviceIndex(activeIndex);

      } catch (err) {
        console.error("Camera access denied", err);
        alert("Camera access denied or not found. Please check permissions, ensure no other app is using the camera, and verify you are running on HTTPS or localhost.");
      }
    }
  };

  const switchCamera = async () => {
    if (videoDevices.length <= 1) return;

    const nextIndex = (currentDeviceIndex + 1) % videoDevices.length;
    setCurrentDeviceIndex(nextIndex);

    if (isLive) {
      // Stop current stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      // Start new stream with the next device
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: videoDevices[nextIndex].deviceId }
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Error switching camera", err);
        // Fallback if exact deviceId fails
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          streamRef.current = stream;
          if (videoRef.current) videoRef.current.srcObject = stream;
        } catch (e) {
          console.error("Fallback failed", e);
        }
      }
    }
  };

  // Load initial history from Firebase
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const recent = await getRecentDecisions(10);
        if (recent) setHistory(recent);
      } catch (err) {
        console.error("Failed to load history", err);
      }
    };
    loadHistory();
  }, []);

  const handleAnalyze = async () => {
    if (status !== DecisionStatus.IDLE && status !== DecisionStatus.COMPLETED) return;

    setStatus(DecisionStatus.ANALYZING);
    setVerdict(null);
    setProgress(0);
    setConfidence(null);
    setAnalysisResult(null);
    setReasoning('');

    // Smooth progress simulation
    const progressInterval = setInterval(() => {
      setProgress(prev => Math.min(prev + Math.random() * 5, 95));
    }, 200);

    try {
      let finalVerdict: Verdict = Verdict.NOT_OUT;
      let aiConfidence: number = 0;
      let aiReasoning: string = "Manual analysis completed.";
      let result: AnalysisResult | null = null;
      let frames: string[] = [];

      if (isLive && videoRef.current) {
        // Wait for video to be ready
        if (videoRef.current.videoWidth === 0) {
          await new Promise(r => {
            if (videoRef.current) videoRef.current.onloadedmetadata = r;
          });
        }
        // Capture 8 frames from live stream over 1.6s for better coverage
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        for (let i = 0; i < 8; i++) {
          if (ctx) {
            ctx.drawImage(videoRef.current, 0, 0);
            frames.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
          }
          await new Promise(r => setTimeout(r, 200));
        }
      } else if (selectedFile) {
        frames = await extractFrames(selectedFile, 8);
      }

      if (frames.length > 0) {
        setIsDemoMode(false);
        // Pass the active decision type so the AI uses the right prompt
        result = await analyzeVideoWithGemini(frames, activeTab);
        finalVerdict = getVerdictFromResult(result, activeTab);
        aiConfidence = result.confidence;
        aiReasoning = result.reasoning;
      } else if (!isLive && !selectedFile) {
        // DEMO MODE — generate realistic mock data based on decision type
        setIsDemoMode(true);
        const mockResult = generateMockAnalysis(activeTab);
        result = mockResult.result;
        finalVerdict = mockResult.verdict;
        aiConfidence = mockResult.result.confidence;
        aiReasoning = mockResult.result.reasoning;
      }

      clearInterval(progressInterval);
      setProgress(100);

      // Build decision details from actual AI analysis
      const details: any = { reasoning: aiReasoning };
      if (result?.lbw_details) {
        details.pitching = result.lbw_details.pitching;
        details.impact = result.lbw_details.impact;
        details.wickets = result.lbw_details.wickets;
      } else if (result?.runout_details) {
        details.batsman_grounded = result.runout_details.batsman_in_crease;
        details.stumps_broken = result.runout_details.stumps_broken;
        details.margin_cm = result.runout_details.margin_cm;
      } else if (result?.edge_details) {
        details.bat_involved = result.edge_details.bat_involved;
        details.spike_detected = result.edge_details.spike_detected;
        details.hotspot_detected = result.edge_details.hotspot_detected;
      }

      const decisionData = {
        match_id: 'LOCAL_BHOPAL_M1',
        batsman: 'V. Singh',
        bowler: 'S. Khan',
        decision_type: activeTab,
        result: finalVerdict as Verdict,
        details
      };

      setVerdict(finalVerdict);
      setConfidence(aiConfidence);
      setAnalysisResult(result);
      setReasoning(aiReasoning);
      setStatus(DecisionStatus.COMPLETED);

      // Confetti on completion — different effects per verdict
      if (finalVerdict === Verdict.UMPIRES_CALL) {
        confetti({
          particleCount: 80,
          spread: 50,
          origin: { y: 0.6 },
          colors: ['#f59e0b', '#fbbf24', '#ffffff']
        });
      } else {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: finalVerdict === Verdict.OUT ? ['#dc2626', '#ffffff'] : ['#4ade80', '#ffffff']
        });
      }

      // Save to Firebase
      await saveDecision(decisionData);
      const recent = await getRecentDecisions(10);
      if (recent) setHistory(recent);

    } catch (err) {
      console.error("Analysis Error:", err);
      alert(`Analysis Failed: ${err instanceof Error ? err.message : 'Unknown error'}. Please try a different video or use the live camera.`);
      setStatus(DecisionStatus.IDLE);
      clearInterval(progressInterval);
    }
  };

  /** Generates realistic ICC-accurate mock analysis data for demo mode.
   * Distribution: ~45% OUT, ~40% NOT OUT, ~15% UMPIRE'S CALL
   * Verdict is derived by the same ICC rules used in determineVerdict().
   */
  function generateMockAnalysis(type: 'LBW' | 'Run-out' | 'Edge Detection'): { result: AnalysisResult; verdict: Verdict } {
    const r = Math.random();

    if (type === 'LBW') {
      // 5 scenarios: 2 OUT, 2 NOT OUT, 1 UMPIRE'S CALL
      const scenarios = [
        // OUT
        { pitching: 'In Line' as const, impact: 'In Line' as const, wickets: 'Hitting' as const, conf: 84, out: true,
          reasoning: 'Ball pitched in line with the stumps, struck the pad in line. Ball-tracking projects the delivery hitting middle and off stump. Decision: OUT LBW.' },
        { pitching: 'Outside Off' as const, impact: 'In Line' as const, wickets: 'Hitting' as const, conf: 78, out: true,
          reasoning: 'Ball pitched outside off, shaped back in sharply. Impact was in line with off stump. Ball tracking shows the delivery hitting off and middle stump. Batsman played no shot. Decision: OUT LBW.' },
        // NOT OUT
        { pitching: 'Outside Leg' as const, impact: 'In Line' as const, wickets: 'Hitting' as const, conf: 91, out: false,
          reasoning: 'Ball pitched outside leg stump. Under ICC DRS rules, a batsman cannot be given out LBW if the ball pitches outside leg stump, regardless of impact or trajectory. Decision: NOT OUT.' },
        { pitching: 'In Line' as const, impact: 'In Line' as const, wickets: 'Missing' as const, conf: 73, out: false,
          reasoning: 'Ball pitched in line and struck the pad in line, but ball-tracking shows the delivery going over the top of the stumps. Decision: NOT OUT — missing over the stumps.' },
        // UMPIRE'S CALL (genuine clipping scenario)
        { pitching: 'In Line' as const, impact: 'In Line' as const, wickets: 'Clipping' as const, conf: 67, out: false,
          reasoning: 'Ball pitched in line, struck the pad in line. Ball tracking shows the delivery clipping the top of leg stump bail — a marginal hit. This is Umpire\'s Call; the original decision stands.' },
      ];
      const s = scenarios[Math.floor(r * scenarios.length)];
      const result: AnalysisResult = {
        decision_type: 'LBW', is_out: s.out, confidence: s.conf, reasoning: s.reasoning,
        lbw_details: { pitching: s.pitching, impact: s.impact, wickets: s.wickets, ball_tracking_confidence: s.conf + Math.floor(Math.random() * 8) - 4 },
        runout_details: null, edge_details: null
      };
      // Apply same ICC verdict logic as determineVerdict()
      let verdict: Verdict;
      if (s.pitching === 'Outside Leg') verdict = Verdict.NOT_OUT;
      else if (s.wickets === 'Missing') verdict = Verdict.NOT_OUT;
      else if (s.wickets === 'Clipping') verdict = Verdict.UMPIRES_CALL;
      else verdict = s.out ? Verdict.OUT : Verdict.NOT_OUT;
      return { result, verdict };
    }

    if (type === 'Run-out') {
      // 5 scenarios: 3 OUT, 2 NOT OUT (margin < 2cm = UMPIRE'S CALL per new logic)
      const scenarios = [
        // OUT
        { inCrease: false, broken: true, direct: true, margin: 28, conf: 91, out: true,
          reasoning: 'Batsman was clearly short of the crease. The direct hit from mid-off broke the stumps with the batsman still running. Margin of 28cm. Decision: OUT — Run Out.' },
        { inCrease: false, broken: true, direct: false, margin: 14, conf: 83, out: true,
          reasoning: 'Quick throw from deep fine-leg. The wicket-keeper collected and broke the stumps while the batsman was 14cm short of the crease line. Decision: OUT — Run Out.' },
        { inCrease: false, broken: true, direct: true, margin: 7, conf: 77, out: true,
          reasoning: 'Direct hit from cover. The batsman\'s bat was 7cm short of the crease when the bails were dislodged. Clear run-out. Decision: OUT.' },
        // NOT OUT
        { inCrease: true, broken: true, direct: false, margin: 0, conf: 88, out: false,
          reasoning: 'Batsman\'s bat was grounded behind the crease before the bails were dislodged. The third umpire confirms the bat was in. Decision: NOT OUT.' },
        { inCrease: true, broken: true, direct: true, margin: 0, conf: 85, out: false,
          reasoning: 'Close call — direct hit from point. However, the batsman had just grounded the bat behind the crease line when the stumps were disturbed. Decision: NOT OUT.' },
      ];
      const s = scenarios[Math.floor(r * scenarios.length)];
      const result: AnalysisResult = {
        decision_type: 'Run-out', is_out: s.out, confidence: s.conf, reasoning: s.reasoning,
        lbw_details: null,
        runout_details: { batsman_in_crease: s.inCrease, stumps_broken: s.broken, direct_hit: s.direct, margin_cm: s.margin },
        edge_details: null
      };
      // Apply same ICC verdict logic as determineVerdict()
      let verdict: Verdict;
      if (!s.broken) verdict = Verdict.NOT_OUT;
      else if (s.inCrease) verdict = Verdict.NOT_OUT;
      else if (s.margin > 0 && s.margin < 3) verdict = Verdict.UMPIRES_CALL;
      else verdict = s.out ? Verdict.OUT : Verdict.NOT_OUT;
      return { result, verdict };
    }

    // Edge Detection: 5 scenarios: 2 OUT, 2 NOT OUT, 1 UMPIRE'S CALL
    const scenarios = [
      // OUT
      { bat: true, pad: false, spike: true, hotspot: true, sound: true, conf: 93, out: true,
        reasoning: 'Clear edge detected. UltraEdge shows a pronounced spike as the ball passes the bat. Hotspot confirms a heat mark on the outside edge of the bat. Ball carried cleanly to the wicket-keeper. Decision: OUT — caught behind.' },
      { bat: true, pad: false, spike: true, hotspot: true, sound: false, conf: 87, out: true,
        reasoning: 'UltraEdge registers a clear spike and Hotspot confirms bat contact. The ball deflected to first slip where it was caught cleanly. Decision: OUT — caught in the slip cordon.' },
      // NOT OUT
      { bat: false, pad: true, spike: false, hotspot: false, sound: false, conf: 88, out: false,
        reasoning: 'No edge detected. UltraEdge remains flat as the ball passes the bat. Hotspot shows no friction mark on the bat. The ball struck the front pad only. Decision: NOT OUT.' },
      { bat: false, pad: false, spike: false, hotspot: false, sound: false, conf: 91, out: false,
        reasoning: 'The ball passed the outside edge cleanly with no contact. UltraEdge is completely flat. No Hotspot mark. The appeal was for a phantom edge. Decision: NOT OUT.' },
      // UMPIRE'S CALL (spike without hotspot)
      { bat: true, pad: true, spike: true, hotspot: false, sound: true, conf: 58, out: false,
        reasoning: 'UltraEdge shows a small spike but Hotspot does not confirm bat contact. The spike may be from the bat passing close to the pad or a sound anomaly. Technology is inconclusive. Decision: UMPIRE\'S CALL — original decision stands.' },
    ];
    const s = scenarios[Math.floor(r * scenarios.length)];
    const result: AnalysisResult = {
      decision_type: 'Edge Detection', is_out: s.out, confidence: s.conf, reasoning: s.reasoning,
      lbw_details: null, runout_details: null,
      edge_details: { bat_involved: s.bat, pad_involved: s.pad, spike_detected: s.spike, hotspot_detected: s.hotspot, sound_anomaly: s.sound }
    };
    // Apply same ICC verdict logic as determineVerdict()
    let verdict: Verdict;
    if (!s.bat && !s.spike) verdict = Verdict.NOT_OUT;
    else if (s.pad && !s.bat) verdict = Verdict.NOT_OUT;
    else if (s.spike && !s.hotspot) verdict = Verdict.UMPIRES_CALL;
    else verdict = s.out ? Verdict.OUT : Verdict.NOT_OUT;
    return { result, verdict };
  }

  const handleReset = () => {
    setStatus(DecisionStatus.IDLE);
    setVerdict(null);
    setProgress(0);
    setSelectedFile(null);
    setConfidence(null);
    setAnalysisResult(null);
    setReasoning('');
    setIsDemoMode(false);
  };

  const exportDecisionCard = () => {
    if (!verdict) return;

    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 500;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Gradient Background
    const gradient = ctx.createLinearGradient(0, 0, 0, 500);
    gradient.addColorStop(0, '#0f172a');
    gradient.addColorStop(1, '#1e293b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 800, 500);

    // Top Bar
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(0, 0, 800, 100);

    // Logo Text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('BALLOUT PRO DRS', 40, 65);

    // Match Details
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${matchInfo.teamA} VS ${matchInfo.teamB}`, 40, 160);

    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`VENUE: ${matchInfo.location}`, 40, 195);

    // Result Box
    ctx.fillStyle = verdict === Verdict.OUT ? '#ef4444' : verdict === Verdict.UMPIRES_CALL ? '#d97706' : '#22c55e';
    ctx.roundRect(40, 240, 300, 120, 15);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = verdict === Verdict.UMPIRES_CALL ? 'bold 40px sans-serif' : 'bold 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(verdict.toUpperCase(), 190, verdict === Verdict.UMPIRES_CALL ? 310 : 325);

    // Stats
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(`AI CONFIDENCE: ${confidence ?? 0}%`, 400, 275);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px sans-serif';
    ctx.fillText(`• TYPE: ${activeTab.toUpperCase()}`, 400, 310);
    
    // Show type-specific tracking data
    if (analysisResult?.lbw_details) {
      ctx.fillText(`• PITCHING: ${analysisResult.lbw_details.pitching.toUpperCase()}`, 400, 340);
      ctx.fillText(`• WICKETS: ${analysisResult.lbw_details.wickets.toUpperCase()}`, 400, 365);
    } else if (analysisResult?.runout_details) {
      ctx.fillText(`• CREASE: ${analysisResult.runout_details.batsman_in_crease ? 'SAFE' : 'SHORT'}`, 400, 340);
      ctx.fillText(`• MARGIN: ${analysisResult.runout_details.margin_cm}CM`, 400, 365);
    } else if (analysisResult?.edge_details) {
      ctx.fillText(`• ULTRA EDGE: ${analysisResult.edge_details.spike_detected ? 'SPIKE' : 'FLAT'}`, 400, 340);
      ctx.fillText(`• HOTSPOT: ${analysisResult.edge_details.hotspot_detected ? 'CONFIRMED' : 'NONE'}`, 400, 365);
    } else {
      ctx.fillText('• TRACKING: COMPLETE', 400, 340);
    }

    // Footer
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 440, 800, 60);
    ctx.fillStyle = '#64748b';
    ctx.font = '14px sans-serif';
    ctx.fillText(`OFFICIAL BPL AI UMPIRE | SESSION ID: ${Math.random().toString(36).substr(2, 9).toUpperCase()}`, 40, 475);

    const link = document.createElement('a');
    link.download = `ballout-drs-report.png`;
    link.href = canvas.toDataURL();
    link.click();
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setStatus(DecisionStatus.IDLE);
      setVerdict(null);
      setProgress(0);
      setConfidence(null);
    }
  };

  if (view === 'HOME') {
    return (
      <div className="home-wrap">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="home-logo-row">
            <div className="home-logo-mark">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="7" stroke="#0A0B0D" strokeWidth="2"/>
                <path d="M9 4v10M5 7l4-3 4 3" stroke="#0A0B0D" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="home-wordmark">BallOut<span style={{color:'var(--amber)'}}>Pro</span></span>
          </div>
          <p className="home-subtitle">Bhopal Official DRS System · AI v2.0</p>
        </motion.div>

        <motion.div
          className="home-form"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
        >
          {/* Team A */}
          <div className="form-group">
            <label className="label">Batting Side</label>
            <input
              id="team-a-input"
              className="form-input"
              placeholder="Team A"
              value={matchInfo.teamA}
              onChange={e => setMatchInfo({ ...matchInfo, teamA: e.target.value })}
            />
          </div>

          <div className="vs-divider">
            <div className="vs-line" />
            <span className="vs-label">vs</span>
            <div className="vs-line" />
          </div>

          {/* Team B */}
          <div className="form-group">
            <label className="label">Fielding Side</label>
            <input
              id="team-b-input"
              className="form-input"
              placeholder="Team B"
              value={matchInfo.teamB}
              onChange={e => setMatchInfo({ ...matchInfo, teamB: e.target.value })}
            />
          </div>

          {/* Venue */}
          <div className="form-group">
            <label className="label">Venue</label>
            <input
              id="venue-input"
              className="form-input"
              placeholder="Ground name"
              value={matchInfo.location}
              onChange={e => setMatchInfo({ ...matchInfo, location: e.target.value })}
            />
          </div>

          <div style={{ height: 4 }} />

          <button
            id="start-session-btn"
            className="btn btn-primary"
            disabled={!matchInfo.teamA || !matchInfo.teamB}
            onClick={() => setView('ANALYZER')}
          >
            Initialize Session
            <ChevronRight style={{ width: 14, height: 14 }} />
          </button>

          {/* Status row */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 8 }}>
            <span className="badge active">
              <span className="pulse-dot" style={{ color: 'var(--green)' }} />
              AI Server Live
            </span>
            <span className="badge">Bhopal, IN</span>
            <span className="badge">Gemini 2.0</span>
          </div>
        </motion.div>

        {/* Footer */}
        <p style={{ marginTop: 48, fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', letterSpacing: '0.14em', textTransform: 'uppercase', textAlign: 'center' }}>
          Made with ♥ by Veerendra, Aman & Avhigyan · GDG Bhopal
        </p>
      </div>
    );
  }

  // ── Confidence bar class helper ──────────────────────────
  const confClass = (c: number | null) =>
    c === null ? '' : c >= 70 ? 'hi' : c >= 45 ? 'mid' : 'low';

  const verdictKey = verdict === Verdict.OUT ? 'out' : verdict === Verdict.UMPIRES_CALL ? 'umpires-call' : 'not-out';

  return (
    <div className="analyzer-wrap">
      {/* ── Top bar ───────────────────────────────────────── */}
      <div className="topbar">
        {/* Logo */}
        <div
          className="topbar-logo"
          onClick={() => setView('HOME')}
          style={{ cursor: 'pointer' }}
          id="back-home-btn"
        >
          <div className="topbar-logo-mark">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="#0A0B0D" strokeWidth="1.5"/>
              <path d="M6 3v6M3.5 5l2.5-2 2.5 2" stroke="#0A0B0D" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          BallOut<span style={{ color: 'var(--amber)' }}>Pro</span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Match chip */}
        {matchInfo.teamA && matchInfo.teamB && (
          <div className="match-chip">
            <span className="label label-white">{matchInfo.teamA}</span>
            <span className="label" style={{ color: 'var(--amber)' }}>vs</span>
            <span className="label label-white">{matchInfo.teamB}</span>
          </div>
        )}

        <span className="badge">{matchInfo.location}</span>

        {isLive && <span className="badge live"><span className="pulse-dot" />Live</span>}

        <button
          id="export-btn"
          className="btn btn-ghost"
          onClick={exportDecisionCard}
          disabled={!verdict}
          style={{ fontSize: 9 }}
        >
          <Zap style={{ width: 11, height: 11 }} />
          Export
        </button>
      </div>

      {/* ── Main grid ─────────────────────────────────────── */}
      <div className="main-grid">

        {/* ── Video panel (left) ────────────────────────── */}
        <div className="video-panel">
          <div className="video-stage">
            {/* Corner brackets — broadcast overlay feel */}
            <div className="corner-tl" />
            <div className="corner-tr" />
            <div className="corner-bl" />
            <div className="corner-br" />

            {/* Camera / file label */}
            <div style={{
              position: 'absolute', top: 16, left: 16, zIndex: 20,
              display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none'
            }}>
              <span className="badge">{isLive ? 'Cam-01 · Live' : selectedFile ? 'Clip loaded' : 'Cam-01 · Side-on'}</span>
              <span className="badge">120.4 fps</span>
            </div>

            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="video/*" onChange={onFileChange} />

            {/* Content: live / file / empty */}
            {isLive ? (
              <video
                ref={(el) => {
                  // @ts-ignore
                  videoRef.current = el;
                  if (el && streamRef.current && el.srcObject !== streamRef.current) {
                    el.srcObject = streamRef.current;
                    el.play().catch(console.error);
                  }
                }}
                autoPlay playsInline muted
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onLoadedMetadata={e => e.currentTarget.play().catch(console.error)}
              />
            ) : selectedFile ? (
              <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                <video
                  src={URL.createObjectURL(selectedFile)}
                  controls
                  style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#050608' }}
                />
                <button
                  className="btn btn-ghost"
                  onClick={() => setSelectedFile(null)}
                  style={{
                    position: 'absolute', top: 12, right: 12,
                    zIndex: 10, fontSize: 9, padding: '5px 10px'
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div
                className="drop-zone"
                id="drop-zone"
                style={{ width: '90%', maxWidth: 360 }}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload style={{ width: 28, height: 28, color: 'var(--muted)' }} />
                <div>
                  <p style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--white-70)', marginBottom: 4 }}>
                    Drop match footage
                  </p>
                  <p style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                    Upload a local clip or use live camera.<br />
                    Or click Analyze Decision for a demo.
                  </p>
                </div>
              </div>
            )}

            {/* Analyzing overlay */}
            {status === DecisionStatus.ANALYZING && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 30,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 24,
                background: 'rgba(10,11,13,0.80)', backdropFilter: 'blur(8px)'
              }}>
                <div className="spinner" />
                <div style={{ textAlign: 'center', width: 200 }}>
                  <p className="analyzing-text" style={{
                    fontFamily: 'var(--mono)', fontSize: 9,
                    fontWeight: 700, letterSpacing: '0.18em',
                    textTransform: 'uppercase', marginBottom: 12
                  }}>
                    AI Umpire Processing…
                  </p>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <p style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', marginTop: 6 }}>
                    {Math.round(progress)}%
                  </p>
                </div>
              </div>
            )}

            {/* Verdict overlay */}
            <AnimatePresence>
              {status === DecisionStatus.COMPLETED && verdict && (
                <motion.div
                  key="verdict"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="verdict-card"
                >
                  <div className={`verdict-banner ${verdictKey}`}>
                    <span className="verdict-eyebrow">Third Umpire Decision</span>
                    <span className={`verdict-text ${verdictKey}`}>{verdict}</span>
                    {confidence !== null && (
                      <span style={{
                        fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
                        color: 'var(--muted-hi)', letterSpacing: '0.08em',
                        position: 'relative', zIndex: 2, marginTop: 4
                      }}>
                        AI Confidence: {confidence}%
                      </span>
                    )}
                  </div>

                  <button
                    id="new-appeal-btn"
                    className="btn btn-ghost"
                    onClick={handleReset}
                    style={{ marginTop: 8 }}
                  >
                    <RefreshCcw style={{ width: 12, height: 12 }} />
                    New Appeal
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* UltraEdge graph — bottom left (decorative when no data) */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              padding: '8px 16px 10px',
              borderTop: '1px solid var(--rule)',
              background: 'var(--panel)',
              display: 'flex', alignItems: 'center', gap: 12, zIndex: 10
            }}>
              <span className="label" style={{ flexShrink: 0 }}>UltraEdge</span>
              <div className="edge-graph" style={{ flex: 1 }}>
                {(() => {
                  const edge = analysisResult?.edge_details;
                  const hasSpikeAt = edge?.spike_detected ? 8 : -1;
                  return [3,5,2,4,3,6,4,7,edge?.spike_detected?38:3,5,3,4,2,5,3,2,4,3,5,2].map((h, i) => (
                    <div
                      key={i}
                      className={`edge-bar${i === hasSpikeAt ? ' spike' : ''}`}
                      style={{ height: `${h * (status === DecisionStatus.COMPLETED ? 1 : 0.3)}%`, minHeight: 2 }}
                    />
                  ));
                })()}
              </div>
              {analysisResult?.edge_details && (
                <span className={`badge ${analysisResult.edge_details.spike_detected ? 'amber' : ''}`} style={{ flexShrink: 0, fontSize: 7 }}>
                  {analysisResult.edge_details.spike_detected ? 'Spike' : 'Flat'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Decision panel (right) ──────────────────────── */}
        <div className="decision-panel">

          {/* Decision type tabs */}
          <div className="panel-section">
            <p className="panel-label">Analysis Type</p>
            <div className="tab-strip" id="decision-type-tabs">
              {(['LBW', 'Run-out', 'Edge Detection'] as const).map(tab => (
                <button
                  key={tab}
                  id={`tab-${tab.toLowerCase().replace(' ', '-')}`}
                  className={`tab-btn${activeTab === tab ? ' active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'Edge Detection' ? 'Edge' : tab}
                </button>
              ))}
            </div>
          </div>

          {/* Tracking data */}
          <div className="panel-section">
            <p className="panel-label">
              {activeTab} Tracking
              <Radio style={{ width: 9, height: 9, color: status === DecisionStatus.ANALYZING ? 'var(--red)' : 'var(--muted)' }} />
            </p>

            {activeTab === 'LBW' && (() => {
              const lbw = analysisResult?.lbw_details;
              const pitch = lbw?.pitching ?? '—';
              const imp = lbw?.impact ?? '—';
              const wkt = lbw?.wickets ?? '—';
              return (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  <div className="stat-cell">
                    <span className="label">Pitching</span>
                    <span className={`stat-value ${pitch === 'Outside Leg' ? 'out' : pitch === 'In Line' ? 'safe' : pitch === '—' ? 'muted' : 'warn'}`}>{pitch}</span>
                  </div>
                  <div className="stat-cell">
                    <span className="label">Impact</span>
                    <span className={`stat-value ${imp === 'Outside Off' || imp === 'Outside Leg' ? 'out' : imp === 'In Line' ? 'safe' : 'muted'}`}>{imp}</span>
                  </div>
                  <div className="stat-cell">
                    <span className="label">Wickets</span>
                    <span className={`stat-value ${wkt === 'Hitting' ? 'safe' : wkt === 'Missing' ? 'out' : wkt === 'Clipping' ? 'warn' : 'muted'}`}>{wkt}</span>
                  </div>
                  {lbw && (
                    <div className="stat-cell" style={{ gridColumn: '1 / -1' }}>
                      <span className="label">Ball Tracking Confidence</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <div className="conf-bar-track" style={{ flex: 1 }}>
                          <div className={`conf-bar-fill ${confClass(lbw.ball_tracking_confidence)}`} style={{ width: `${lbw.ball_tracking_confidence}%` }} />
                        </div>
                        <span className="stat-value">{lbw.ball_tracking_confidence}%</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {activeTab === 'Run-out' && (() => {
              const ro = analysisResult?.runout_details;
              return (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  <div className="stat-cell">
                    <span className="label">Crease</span>
                    <span className={`stat-value ${ro === null ? 'muted' : ro?.batsman_in_crease ? 'safe' : 'out'}`}>{ro ? (ro.batsman_in_crease ? 'Safe' : 'Short') : '—'}</span>
                  </div>
                  <div className="stat-cell">
                    <span className="label">Stumps</span>
                    <span className={`stat-value ${ro === null ? 'muted' : ro?.stumps_broken ? 'out' : 'safe'}`}>{ro ? (ro.stumps_broken ? 'Broken' : 'Intact') : '—'}</span>
                  </div>
                  <div className="stat-cell">
                    <span className="label">Margin</span>
                    <span className={`stat-value ${ro === null ? 'muted' : ro.margin_cm < 3 ? 'warn' : ro.margin_cm === 0 ? 'safe' : 'out'}`}>{ro ? `${ro.margin_cm} cm` : '—'}</span>
                  </div>
                  <div className="stat-cell" style={{ gridColumn: '1 / -1' }}>
                    <span className="label">Hit Type</span>
                    <span className="stat-value muted">{ro ? (ro.direct_hit ? 'Direct Hit' : 'Keeper Collect') : '—'}</span>
                  </div>
                </div>
              );
            })()}

            {activeTab === 'Edge Detection' && (() => {
              const edge = analysisResult?.edge_details;
              const items = [
                { label: 'UltraEdge', val: edge ? (edge.spike_detected ? 'Spike' : 'Flat') : '—', cls: edge?.spike_detected ? 'warn' : edge ? 'safe' : 'muted' },
                { label: 'Hotspot', val: edge ? (edge.hotspot_detected ? 'Mark' : 'None') : '—', cls: edge?.hotspot_detected ? 'safe' : edge ? 'out' : 'muted' },
                { label: 'Bat', val: edge ? (edge.bat_involved ? 'Contact' : 'Clear') : '—', cls: edge?.bat_involved ? 'warn' : edge ? 'safe' : 'muted' },
                { label: 'Pad', val: edge ? (edge.pad_involved ? 'Hit' : 'Clear') : '—', cls: edge?.pad_involved ? 'warn' : edge ? 'safe' : 'muted' },
                { label: 'Sound', val: edge ? (edge.sound_anomaly ? 'Click' : 'Clean') : '—', cls: edge?.sound_anomaly ? 'warn' : edge ? 'safe' : 'muted' },
              ];
              return (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  {items.slice(0,3).map(({ label, val, cls }) => (
                    <div key={label} className="stat-cell">
                      <span className="label">{label}</span>
                      <span className={`stat-value ${cls}`}>{val}</span>
                    </div>
                  ))}
                  {items.slice(3).map(({ label, val, cls }) => (
                    <div key={label} className="stat-cell">
                      <span className="label">{label}</span>
                      <span className={`stat-value ${cls}`}>{val}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Confidence */}
          {confidence !== null && (
            <div className="panel-section">
              <p className="panel-label">AI Confidence</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="conf-bar-track" style={{ flex: 1 }}>
                  <div className={`conf-bar-fill ${confClass(confidence)}`} style={{ width: `${confidence}%` }} />
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--white)', minWidth: 32, textAlign: 'right' }}>
                  {confidence}%
                </span>
              </div>
            </div>
          )}

          {/* AI Reasoning */}
          {reasoning && (
            <div className="panel-section">
              <p className="panel-label">
                AI Reasoning
                {isDemoMode && (
                  <span className="badge amber" style={{ fontSize: 7 }}>Demo</span>
                )}
              </p>
              <div className="reasoning-block">
                {reasoning}
                {isDemoMode && (
                  <p style={{ color: 'var(--muted)', fontSize: 10, marginTop: 8, fontStyle: 'italic' }}>
                    Upload a video or use live camera to run real AI analysis.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Session history */}
          {history.length > 0 && (
            <div className="panel-section" style={{ flex: 1 }}>
              <p className="panel-label">
                Session Log
                <span className="badge">{history.length}</span>
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {history.slice(0, 6).map(item => {
                  const v = item.result || item.verdict;
                  const dotCls = v === Verdict.OUT ? 'out' : v === Verdict.UMPIRES_CALL ? 'uc' : 'not-out';
                  return (
                    <div key={item.id} className="history-item">
                      <div className={`history-dot ${dotCls}`} />
                      <span className="label label-white" style={{ flex: 1 }}>{item.decision_type || item.type}</span>
                      <span className="label" style={{ color: v === Verdict.OUT ? 'var(--red)' : v === Verdict.UMPIRES_CALL ? 'var(--amber)' : 'var(--green)' }}>{v}</span>
                      <span className="label" style={{ minWidth: 36, textAlign: 'right' }}>
                        {item.timestamp?.toDate ? item.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Action footer ─────────────────────────────── */}
          <div className="action-footer">
            <button
              id="analyze-btn"
              className="btn btn-primary"
              onClick={handleAnalyze}
              disabled={status === DecisionStatus.ANALYZING}
            >
              {status === DecisionStatus.ANALYZING ? (
                <>
                  <RefreshCcw style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} />
                  Analyzing…
                </>
              ) : (
                <>
                  <Cpu style={{ width: 12, height: 12 }} />
                  Analyze Decision
                </>
              )}
            </button>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button
                id="live-cam-btn"
                className={`btn btn-ghost${isLive ? ' live' : ''}`}
                onClick={toggleLive}
                style={isLive ? { color: 'var(--red)', borderColor: 'var(--red)', background: 'var(--red-dim)' } : {}}
              >
                <Radio style={{ width: 11, height: 11 }} />
                {isLive ? 'Stop Live' : 'Live Cam'}
              </button>

              <button
                id="upload-clip-btn"
                className="btn btn-ghost"
                onClick={() => { setIsLive(false); fileInputRef.current?.click(); }}
              >
                <Upload style={{ width: 11, height: 11 }} />
                Upload Clip
              </button>

              {isLive && videoDevices.length > 1 && (
                <button className="btn btn-ghost" onClick={switchCamera} style={{ gridColumn: '1 / -1' }}>
                  Switch Camera
                </button>
              )}

              <button
                id="reset-btn"
                className="btn btn-ghost"
                onClick={handleReset}
                style={{ gridColumn: '1 / -1' }}
              >
                <RefreshCcw style={{ width: 11, height: 11 }} />
                Reset Session
              </button>
            </div>

            <p style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--muted)', textAlign: 'center', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
              Made with ♥ by Veerendra, Aman & Abhigyan · GDG Bhopal
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

