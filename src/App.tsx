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
        // Pass the active decision type so the AI uses the right prompt
        result = await analyzeVideoWithGemini(frames, activeTab);
        finalVerdict = getVerdictFromResult(result, activeTab);
        aiConfidence = result.confidence;
        aiReasoning = result.reasoning;
      } else if (!isLive && !selectedFile) {
        // DEMO MODE — generate realistic mock data based on decision type
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

  /** Generates realistic mock analysis data for demo mode */
  function generateMockAnalysis(type: 'LBW' | 'Run-out' | 'Edge Detection'): { result: AnalysisResult; verdict: Verdict } {
    const r = Math.random();
    
    if (type === 'LBW') {
      const scenarios = [
        { pitching: 'In Line' as const, impact: 'In Line' as const, wickets: 'Hitting' as const, conf: 82, out: true, reasoning: 'Ball pitched in line, struck pad in line with the stumps. Ball tracking shows the delivery going on to hit middle and leg stump. Decision: OUT.' },
        { pitching: 'In Line' as const, impact: 'In Line' as const, wickets: 'Clipping' as const, conf: 48, out: false, reasoning: 'Ball pitched in line and impact was in line, but ball tracking shows only marginal contact with leg stump bail. Within the Umpire\'s Call zone.' },
        { pitching: 'Outside Off' as const, impact: 'In Line' as const, wickets: 'Missing' as const, conf: 76, out: false, reasoning: 'Ball pitched outside off stump, straightened after pitching. Impact in line but ball tracking shows the delivery going over the stumps. Decision: NOT OUT.' },
        { pitching: 'Outside Leg' as const, impact: 'In Line' as const, wickets: 'Hitting' as const, conf: 91, out: false, reasoning: 'Ball pitched outside leg stump. Under ICC rules, cannot be given out LBW regardless of other factors. Decision: NOT OUT.' },
        { pitching: 'In Line' as const, impact: 'Outside Off' as const, wickets: 'Hitting' as const, conf: 70, out: false, reasoning: 'Ball pitched in line but impact was outside the line of off stump. Batsman was playing a shot. Decision: NOT OUT.' },
      ];
      const s = scenarios[Math.floor(r * scenarios.length)];
      const result: AnalysisResult = {
        decision_type: 'LBW', is_out: s.out, confidence: s.conf, reasoning: s.reasoning,
        lbw_details: { pitching: s.pitching, impact: s.impact, wickets: s.wickets, ball_tracking_confidence: s.conf + Math.floor(Math.random() * 10) - 5 },
        runout_details: null, edge_details: null
      };
      const verdict = s.wickets === 'Clipping' ? Verdict.UMPIRES_CALL : (s.out ? Verdict.OUT : Verdict.NOT_OUT);
      return { result, verdict };
    }

    if (type === 'Run-out') {
      const scenarios = [
        { inCrease: false, broken: true, direct: true, margin: 22, conf: 88, out: true, reasoning: 'Batsman was well short of the crease when the stumps were broken by a direct hit from cover. Clear run-out.' },
        { inCrease: true, broken: true, direct: false, margin: 15, conf: 79, out: false, reasoning: 'Batsman\'s bat was grounded behind the crease before the bails were dislodged. Comfortably in.' },
        { inCrease: false, broken: true, direct: true, margin: 3, conf: 52, out: true, reasoning: 'Extremely tight call. The batsman appears marginally short but the margin is within the Umpire\'s Call zone (< 5cm).' },
        { inCrease: true, broken: true, direct: true, margin: 8, conf: 85, out: false, reasoning: 'Direct hit but the batsman had grounded the bat behind the line. Replay confirms NOT OUT.' },
      ];
      const s = scenarios[Math.floor(r * scenarios.length)];
      const result: AnalysisResult = {
        decision_type: 'Run-out', is_out: s.out, confidence: s.conf, reasoning: s.reasoning,
        lbw_details: null,
        runout_details: { batsman_in_crease: s.inCrease, stumps_broken: s.broken, direct_hit: s.direct, margin_cm: s.margin },
        edge_details: null
      };
      const verdict = s.margin < 5 ? Verdict.UMPIRES_CALL : (s.out ? Verdict.OUT : Verdict.NOT_OUT);
      return { result, verdict };
    }

    // Edge Detection
    const scenarios = [
      { bat: true, pad: false, spike: true, hotspot: true, sound: true, conf: 92, out: true, reasoning: 'Clear edge detected. UltraEdge shows a significant spike as ball passes the bat. Hotspot confirms friction mark on the bat edge. Ball carried cleanly to the wicket-keeper.' },
      { bat: false, pad: true, spike: false, hotspot: false, sound: false, conf: 85, out: false, reasoning: 'No edge detected. UltraEdge is flat as ball passes the bat. Ball struck the pad only. No Hotspot mark on bat.' },
      { bat: true, pad: true, spike: true, hotspot: false, sound: true, conf: 55, out: false, reasoning: 'Inconclusive. UltraEdge shows a small spike but Hotspot does not confirm contact. Could be bat-pad or pad-bat. Within Umpire\'s Call threshold.' },
      { bat: false, pad: false, spike: false, hotspot: false, sound: false, conf: 90, out: false, reasoning: 'Ball passed bat and pad cleanly. No spike on UltraEdge, no Hotspot mark. The appeal was for a phantom edge.' },
    ];
    const s = scenarios[Math.floor(r * scenarios.length)];
    const result: AnalysisResult = {
      decision_type: 'Edge Detection', is_out: s.out, confidence: s.conf, reasoning: s.reasoning,
      lbw_details: null, runout_details: null,
      edge_details: { bat_involved: s.bat, pad_involved: s.pad, spike_detected: s.spike, hotspot_detected: s.hotspot, sound_anomaly: s.sound }
    };
    const verdict = (s.spike && !s.hotspot && s.conf < 65) ? Verdict.UMPIRES_CALL : (s.out ? Verdict.OUT : Verdict.NOT_OUT);
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
      <div className="min-h-screen w-full bg-drs-bg flex items-center justify-center p-4 sm:p-6 overflow-hidden relative">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1540741282451-0a0f93a052d6?q=80&w=2070')] bg-cover bg-center opacity-10"></div>
        <div className="absolute inset-0 bg-gradient-to-br from-brand/20 via-transparent to-transparent"></div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 w-full max-w-xl"
        >
          <div className="text-center mb-8 sm:mb-12">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-brand rounded-2xl flex items-center justify-center border border-white/20 shadow-2xl shadow-brand/40 mx-auto mb-4 sm:mb-6 rotate-12">
              <Triangle className="text-white w-8 h-8 sm:w-10 sm:h-10 fill-white rotate-180" />
            </div>
            <h1 className="text-4xl sm:text-6xl font-black italic tracking-tighter uppercase mb-2">BallOut <span className="text-brand">Pro</span></h1>
            <p className="text-slate-400 font-bold tracking-[0.2em] text-[10px] sm:text-xs uppercase">Bhopal Official DRS System • AI v2.0</p>
          </div>

          <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 p-6 sm:p-8 rounded-3xl shadow-2xl space-y-6">
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Match Teams</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <input
                    placeholder="Team A Name"
                    value={matchInfo.teamA}
                    onChange={e => setMatchInfo({ ...matchInfo, teamA: e.target.value })}
                    className="bg-black/40 border border-slate-700 p-3 sm:p-4 rounded-xl text-sm focus:border-brand outline-none transition-all"
                  />
                  <input
                    placeholder="Team B Name"
                    value={matchInfo.teamB}
                    onChange={e => setMatchInfo({ ...matchInfo, teamB: e.target.value })}
                    className="bg-black/40 border border-slate-700 p-3 sm:p-4 rounded-xl text-sm focus:border-brand outline-none transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Venue / Location</label>
                <input
                  placeholder="e.g. Bhopal Old Camp Ground"
                  value={matchInfo.location}
                  onChange={e => setMatchInfo({ ...matchInfo, location: e.target.value })}
                  className="w-full bg-black/40 border border-slate-700 p-3 sm:p-4 rounded-xl text-sm focus:border-brand outline-none transition-all"
                />
              </div>
            </div>

            <button
              disabled={!matchInfo.teamA || !matchInfo.teamB}
              onClick={() => setView('ANALYZER')}
              className="w-full bg-brand hover:bg-brand-hover py-4 sm:py-5 rounded-2xl font-black text-xs sm:text-sm tracking-widest transition-all shadow-xl shadow-brand/20 disabled:opacity-50 uppercase italic flex items-center justify-center gap-2 sm:gap-3"
            >
              Start Session <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>

          <div className="mt-6 sm:mt-8 flex justify-center gap-6 sm:gap-8">
            <div className="text-center">
              <p className="text-[10px] font-bold text-slate-600 uppercase mb-1">Status</p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-[10px] font-mono text-slate-400">AI SERVER LIVE</span>
              </div>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-bold text-slate-600 uppercase mb-1">Region</p>
              <span className="text-[10px] font-mono text-slate-400">BHOPAL, IN</span>
            </div>
          </div>

          <div className="mt-12 sm:mt-16 text-center">
            <p className="text-[9px] sm:text-[10px] font-bold text-slate-500 tracking-widest uppercase">
              Made with <span className="text-red-500">♥</span> by Veerendra, Aman, and Avhigyan
            </p>
            <p className="text-[9px] sm:text-[10px] font-black text-brand tracking-widest uppercase mt-1.5">
              GDG BHOPAL
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] lg:h-screen w-full flex flex-col bg-drs-bg lg:overflow-hidden font-sans">
      {/* Header */}
      <header className="h-16 lg:h-20 border-b border-slate-800 bg-drs-bg/80 backdrop-blur-md px-4 lg:px-8 flex items-center justify-between shrink-0 z-50">
        <div className="flex items-center gap-3 lg:gap-4">
          <div
            onClick={() => setView('HOME')}
            className="w-10 h-10 lg:w-12 lg:h-12 bg-brand rounded-lg flex items-center justify-center border border-white/20 shadow-lg shadow-brand/20 cursor-pointer"
          >
            <Triangle className="text-white w-5 h-5 lg:w-7 lg:h-7 fill-white rotate-180" />
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-black tracking-tighter leading-none italic uppercase">BallOut</h1>
            <div className="flex items-center gap-2">
              <p className="text-[8px] lg:text-[10px] text-brand uppercase tracking-widest font-bold">PRO MODE</p>
            </div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] lg:text-xs text-slate-500 uppercase font-semibold">Live Match</p>
            <p className="text-xs lg:text-sm font-black uppercase text-brand tracking-tighter">{matchInfo.teamA} VS {matchInfo.teamB}</p>
          </div>
          <div className="h-8 w-[1px] bg-slate-800"></div>
          <div className="flex flex-col items-end">
            <p className="text-[8px] lg:text-[10px] text-slate-500 uppercase font-bold">Venue</p>
            <span className="text-[10px] lg:text-xs font-medium text-slate-300">{matchInfo.location}</span>
          </div>
        </div>
      </header>

      {/* Main Layout Grid */}
      <main className="flex-1 flex flex-col lg:grid lg:grid-cols-12 gap-0 lg:overflow-hidden">

        {/* Left Section: Video Analysis Viewport */}
        <section className="h-[45vh] min-h-[280px] sm:min-h-[300px] sm:h-[50vh] lg:h-full lg:col-span-8 bg-black relative flex items-center justify-center lg:border-r border-b lg:border-b-0 border-slate-800 shrink-0 lg:shrink overflow-hidden group">
          {status === DecisionStatus.ANALYZING && <div className="scanline" />}

          <div className="w-full h-full relative bg-gradient-to-t from-slate-900/50 to-drs-bg flex flex-col items-center justify-center">
            {/* Visual Overlays for Technical Feel */}
            <div className="absolute top-4 left-4 sm:top-6 sm:left-6 flex flex-col gap-1 sm:gap-2 z-30 pointer-events-none">
              <span className="bg-black/60 px-2 sm:px-3 py-0.5 sm:py-1 text-[8px] sm:text-[10px] rounded border border-white/20 font-mono tracking-wider text-white uppercase backdrop-blur-sm">Cam-01: Side-on</span>
              <span className="bg-black/60 px-2 sm:px-3 py-0.5 sm:py-1 text-[8px] sm:text-[10px] rounded border border-white/20 font-mono tracking-wider text-white uppercase backdrop-blur-sm">FPS: 120.4</span>
              {isLive && (
                <span className="bg-green-500/80 px-2 sm:px-3 py-0.5 sm:py-1 text-[8px] sm:text-[10px] rounded border border-white/20 font-mono tracking-wider text-white uppercase backdrop-blur-sm animate-pulse">Live Active</span>
              )}
            </div>

            {/* Content Area */}
            <div className="w-full h-full flex items-center justify-center p-0">
              <input type="file" ref={fileInputRef} className="hidden" accept="video/*" onChange={onFileChange} />

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
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover bg-black"
                  onLoadedMetadata={(e) => {
                    e.currentTarget.play().catch(console.error);
                  }}
                />
              ) : selectedFile ? (
                <div className="w-full h-full relative group">
                  <video
                    src={URL.createObjectURL(selectedFile)}
                    controls
                    className="w-full h-full object-contain bg-black"
                  />
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="absolute top-4 right-4 bg-red-500 text-white px-4 py-2 rounded-full text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  >
                    Remove Video
                  </button>
                </div>
              ) : (
                <div className="p-4 sm:p-12 text-center w-full max-w-sm mx-auto z-10 relative">
                  {status === DecisionStatus.IDLE && !verdict && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="cursor-pointer group bg-black/40 sm:bg-transparent backdrop-blur-sm sm:backdrop-blur-none p-4 sm:p-0 rounded-2xl border border-white/5 sm:border-none"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <div className={`w-14 h-14 sm:w-24 sm:h-24 rounded-2xl bg-white/5 border-2 border-dashed border-white/10 group-hover:border-brand flex items-center justify-center mx-auto mb-3 sm:mb-6 transition-colors`}>
                        <Upload className="w-6 h-6 sm:w-10 sm:h-10 text-white/30 group-hover:text-brand transition-colors" />
                      </div>
                      <h3 className="text-lg sm:text-2xl font-bold tracking-tight mb-1 sm:mb-2 text-white">
                        Drop Match Footage
                      </h3>
                      <p className="text-slate-400 text-[10px] sm:text-sm max-w-[220px] sm:max-w-xs mx-auto">
                        Upload local match video for AI-powered trajectory analysis
                      </p>
                    </motion.div>
                  )}
                </div>
              )}

              {status === DecisionStatus.ANALYZING && (
                <div className="w-full max-w-sm space-y-6 text-center z-20 absolute inset-0 m-auto flex flex-col items-center justify-center bg-black/40 backdrop-blur-md rounded-3xl p-12">
                  <div className="relative inline-block">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                      className="w-40 h-40 rounded-full border border-brand/30 border-t-brand"
                    />
                    <Cpu className="absolute inset-0 m-auto w-12 h-12 text-brand animate-pulse" />
                  </div>
                  <div className="space-y-3 w-full">
                    <div className="flex justify-between items-end">
                      <span className="text-[10px] font-bold text-brand uppercase tracking-widest animate-pulse">AI Umpire Thinking...</span>
                      <span className="text-xs font-mono text-slate-400">{Math.round(progress)}%</span>
                    </div>
                    <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                      <motion.div className="h-full bg-brand" animate={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </div>
              )}

              <AnimatePresence>
                {status === DecisionStatus.COMPLETED && verdict && (
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={`z-30 text-center absolute inset-0 m-auto flex flex-col items-center justify-center p-6 sm:p-12 bg-black/40 backdrop-blur-md rounded-3xl ${
                      verdict === Verdict.OUT ? 'verdict-out' : verdict === Verdict.UMPIRES_CALL ? '' : 'verdict-not-out'
                    }`}
                  >
                    <div className={`
                      inline-block px-8 py-4 sm:px-12 sm:py-6 rounded-lg border-4 shadow-2xl transition-all duration-500
                      ${verdict === Verdict.OUT
                        ? 'bg-drs-red border-red-500 shadow-red-900/40'
                        : verdict === Verdict.UMPIRES_CALL
                          ? 'bg-amber-600 border-amber-400 shadow-amber-900/40'
                          : 'bg-drs-green border-green-500 shadow-green-900/40'}
                    `}>
                      <h3 className={`font-black italic tracking-tighter text-white drop-shadow-lg ${
                        verdict === Verdict.UMPIRES_CALL ? 'text-3xl sm:text-5xl' : 'text-5xl sm:text-8xl'
                      }`}>
                        {verdict}
                      </h3>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mt-6 sm:mt-8 items-center">
                      <p className="text-slate-400 font-medium bg-black/40 backdrop-blur-sm py-2 px-4 rounded-full inline-block text-xs sm:text-base">
                        AI Confidence: <span className="text-white">{confidence ?? 0}%</span>
                      </p>
                      <button
                        onClick={exportDecisionCard}
                        className="bg-brand hover:bg-brand-hover text-white text-[10px] font-black uppercase px-6 py-2.5 rounded-full shadow-lg shadow-brand/20 transition-all flex items-center justify-center gap-2 w-full sm:w-auto"
                      >
                        <Zap className="w-3 h-3" /> Export Report
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Bottom Left: Trace Indicators */}
            <div className="absolute bottom-4 left-4 sm:bottom-6 sm:left-6 flex gap-4 pointer-events-none hidden sm:flex">
              <div className="bg-black/60 backdrop-blur-md p-4 rounded-xl border border-slate-800 w-48">
                <p className="text-[9px] text-slate-500 uppercase font-bold mb-3">UltraEdge Track</p>
                <div className="flex items-end gap-[2px] h-12 grayscale opacity-50">
                  {[4, 7, 3, 10, 15, 30, 22, 12, 8, 5, 3, 6, 2].map((h, i) => (
                    <div key={i} className="flex-1 bg-brand h-full" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right Section: Decision Panel */}
        <section className="lg:col-span-4 bg-drs-card flex flex-col h-auto lg:h-full">
          <div className="p-4 lg:p-6 flex-1 lg:overflow-y-auto no-scrollbar">
            <h2 className="text-[10px] lg:text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 lg:mb-6">Decision Matrix</h2>

            {/* Analysis Type Tabs */}
            <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-xl border border-slate-800 mb-4 lg:mb-6">
              {(['LBW', 'Run-out', 'Edge Detection'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`
                    py-2 rounded-lg text-[8px] sm:text-[10px] font-bold uppercase transition-all whitespace-nowrap
                    ${activeTab === tab ? 'bg-slate-800 text-brand' : 'text-slate-500 hover:text-slate-300'}
                  `}
                >
                  {tab === 'Edge Detection' ? 'Edge' : tab}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {/* Decision-Type-Specific Tracking Panel */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 lg:p-5">
                <div className="flex justify-between items-center mb-4">
                  <p className="text-[9px] lg:text-[10px] text-brand font-bold uppercase tracking-wider">{activeTab} Tracking</p>
                  <Radio className="w-3 h-3 text-red-500 animate-pulse" />
                </div>

                {/* LBW Tracking */}
                {activeTab === 'LBW' && (
                  <div className="grid grid-cols-3 gap-2">
                    {(() => {
                      const lbw = analysisResult?.lbw_details;
                      const pitching = lbw?.pitching || (verdict ? 'In Line' : '—');
                      const impact = lbw?.impact || (verdict ? 'In Line' : '—');
                      const wickets = lbw?.wickets || (verdict ? (verdict === Verdict.OUT ? 'Hitting' : 'Missing') : '—');
                      const pitchColor = pitching === 'Outside Leg' ? 'text-drs-red' : pitching === 'In Line' ? 'text-drs-green' : 'text-amber-400';
                      const impactColor = impact === 'Outside Off' || impact === 'Outside Leg' ? 'text-drs-red' : 'text-drs-green';
                      const wicketsColor = wickets === 'Hitting' ? 'text-drs-green' : wickets === 'Clipping' ? 'text-amber-400' : wickets === 'Missing' ? 'text-drs-red' : 'text-slate-500';
                      return [
                        { label: 'PITCHING', value: pitching, color: pitchColor },
                        { label: 'IMPACT', value: impact, color: impactColor },
                        { label: 'WICKETS', value: wickets, color: wicketsColor }
                      ].map((stat, i) => (
                        <div key={i} className="bg-black/40 border border-slate-800 p-2 rounded text-center">
                          <p className="text-[8px] text-slate-500 mb-1 font-bold">{stat.label}</p>
                          <p className={`text-[10px] lg:text-xs font-black uppercase ${stat.color}`}>{stat.value}</p>
                        </div>
                      ));
                    })()}
                  </div>
                )}

                {/* Run-out Tracking */}
                {activeTab === 'Run-out' && (
                  <div className="grid grid-cols-3 gap-2">
                    {(() => {
                      const ro = analysisResult?.runout_details;
                      const crease = ro ? (ro.batsman_in_crease ? 'SAFE' : 'SHORT') : '—';
                      const stumps = ro ? (ro.stumps_broken ? 'BROKEN' : 'INTACT') : '—';
                      const margin = ro ? `${ro.margin_cm}cm` : '—';
                      return [
                        { label: 'CREASE', value: crease, color: crease === 'SAFE' ? 'text-drs-green' : crease === 'SHORT' ? 'text-drs-red' : 'text-slate-500' },
                        { label: 'STUMPS', value: stumps, color: stumps === 'BROKEN' ? 'text-drs-red' : stumps === 'INTACT' ? 'text-drs-green' : 'text-slate-500' },
                        { label: 'MARGIN', value: margin, color: ro && ro.margin_cm < 5 ? 'text-amber-400' : 'text-slate-300' }
                      ].map((stat, i) => (
                        <div key={i} className="bg-black/40 border border-slate-800 p-2 rounded text-center">
                          <p className="text-[8px] text-slate-500 mb-1 font-bold">{stat.label}</p>
                          <p className={`text-[10px] lg:text-xs font-black uppercase ${stat.color}`}>{stat.value}</p>
                        </div>
                      ));
                    })()}
                  </div>
                )}

                {/* Edge Detection Tracking */}
                {activeTab === 'Edge Detection' && (
                  <div className="grid grid-cols-3 gap-2">
                    {(() => {
                      const edge = analysisResult?.edge_details;
                      const spike = edge ? (edge.spike_detected ? 'DETECTED' : 'FLAT') : '—';
                      const hotspot = edge ? (edge.hotspot_detected ? 'CONFIRMED' : 'NONE') : '—';
                      const bat = edge ? (edge.bat_involved ? 'CONTACT' : 'NO CONTACT') : '—';
                      return [
                        { label: 'ULTRA EDGE', value: spike, color: spike === 'DETECTED' ? 'text-drs-green' : spike === 'FLAT' ? 'text-drs-red' : 'text-slate-500' },
                        { label: 'HOTSPOT', value: hotspot, color: hotspot === 'CONFIRMED' ? 'text-drs-green' : hotspot === 'NONE' ? 'text-drs-red' : 'text-slate-500' },
                        { label: 'BAT', value: bat, color: bat === 'CONTACT' ? 'text-drs-green' : bat === 'NO CONTACT' ? 'text-drs-red' : 'text-slate-500' }
                      ].map((stat, i) => (
                        <div key={i} className="bg-black/40 border border-slate-800 p-2 rounded text-center">
                          <p className="text-[8px] text-slate-500 mb-1 font-bold">{stat.label}</p>
                          <p className={`text-[10px] lg:text-xs font-black uppercase ${stat.color}`}>{stat.value}</p>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>

              {/* AI Reasoning */}
              {reasoning && (
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 lg:p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-3 h-3 text-brand" />
                    <p className="text-[9px] lg:text-[10px] text-brand font-bold uppercase tracking-wider">AI Reasoning</p>
                  </div>
                  <p className="text-[10px] lg:text-xs text-slate-300 leading-relaxed">{reasoning}</p>
                </div>
              )}

              {/* Advanced Metadata */}
              <div className="grid grid-cols-2 gap-3 lg:gap-4">
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 lg:p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-3 h-3 text-slate-500" />
                    <span className="text-[8px] lg:text-[9px] text-slate-500 font-bold uppercase">Timestamp</span>
                  </div>
                  <p className="text-[10px] lg:text-xs font-mono">{new Date().toLocaleTimeString()}</p>
                </div>
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 lg:p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Layers className="w-3 h-3 text-slate-500" />
                    <span className="text-[8px] lg:text-[9px] text-slate-500 font-bold uppercase">Confidence</span>
                  </div>
                  <p className={`text-[10px] lg:text-xs font-mono font-bold ${
                    confidence === null ? 'text-slate-500' : confidence >= 70 ? 'text-drs-green' : confidence >= 40 ? 'text-amber-400' : 'text-drs-red'
                  }`}>{confidence !== null ? `${confidence}%` : '—'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons Footer of Sidebar */}
          <div className="p-4 lg:p-6 bg-black/20 border-t border-slate-800 space-y-3 shrink-0">
            <button
              onClick={handleAnalyze}
              disabled={status === DecisionStatus.ANALYZING}
              className="w-full bg-brand hover:bg-brand-hover py-3 lg:py-4 rounded-xl font-black text-xs lg:text-sm tracking-widest transition-all shadow-lg shadow-brand/20 disabled:opacity-50 uppercase italic"
            >
              {status === DecisionStatus.ANALYZING ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCcw className="w-4 h-4 animate-spin" /> Analyzing...
                </span>
              ) : 'Analyze Decision'}
            </button>
            <div className="grid grid-cols-2 gap-2 lg:gap-3">
              <button
                onClick={toggleLive}
                className={`py-2.5 lg:py-3 rounded-lg font-bold text-[9px] lg:text-[10px] uppercase tracking-wider transition-all ${isLive ? 'bg-red-500/20 text-red-500 border border-red-500/50' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                {isLive ? 'Stop Live' : 'Live Cam'}
              </button>
              {isLive && videoDevices.length > 1 && (
                <button
                  onClick={switchCamera}
                  className="bg-brand/20 text-brand border border-brand/50 py-2.5 lg:py-3 rounded-lg font-bold text-[9px] lg:text-[10px] uppercase tracking-wider"
                >
                  Switch Cam
                </button>
              )}
              <button
                onClick={() => {
                  setIsLive(false);
                  fileInputRef.current?.click();
                }}
                className={`bg-slate-800 hover:bg-slate-700 py-2.5 lg:py-3 rounded-lg font-bold text-[9px] lg:text-[10px] text-slate-300 uppercase tracking-wider ${isLive && videoDevices.length > 1 ? 'col-span-2' : ''}`}
              >
                Upload Clip
              </button>
              <button
                onClick={handleReset}
                className="bg-slate-800 hover:bg-slate-700 py-2.5 lg:py-3 rounded-lg font-bold text-[9px] lg:text-[10px] text-slate-300 uppercase tracking-wider col-span-2"
              >
                Reset Session
              </button>
            </div>


          </div>
        </section>
      </main>

      {/* Footer Log */}
      <footer className="h-14 lg:h-20 bg-drs-bg border-t border-slate-800 flex items-center px-4 lg:px-8 gap-4 lg:gap-6 shrink-0">
        <div className="flex items-center gap-2 text-slate-500 shrink-0">
          <History className="w-4 h-4 hidden sm:block" />
          <span className="text-[9px] lg:text-[10px] uppercase font-black tracking-widest mt-0.5">Logs</span>
        </div>

        <div className="flex flex-1 gap-4 overflow-x-auto no-scrollbar py-2">
          <AnimatePresence mode="popLayout">
            {history.map((item) => (
              <motion.div
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                key={item.id}
                className="flex-none bg-slate-900/80 px-4 py-2 rounded-lg border border-slate-800 flex items-center gap-3 hover:border-brand hover:bg-slate-800 transition-all cursor-pointer group"
              >
                <div className="text-[10px] font-bold text-slate-300 uppercase group-hover:text-brand">{item.decision_type || item.type}</div>
                <div className={`text-[10px] px-1.5 py-0.5 rounded font-black italic tracking-tighter ${item.result === Verdict.OUT || item.verdict === Verdict.OUT ? 'bg-red-900/40 text-red-400' : 'bg-green-900/40 text-green-400'}`}>
                  {item.result || item.verdict}
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  {item.timestamp?.toDate ? item.timestamp.toDate().toLocaleTimeString() : (item.timestamp || 'Just now')}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {history.length === 0 && (
            <p className="text-xs text-slate-600 italic flex items-center">Waiting for first analysis...</p>
          )}
        </div>

        <div className="hidden lg:flex flex-col justify-center items-end shrink-0 ml-4 border-l border-slate-800 pl-6 h-full text-[9px] font-bold text-slate-500 tracking-widest uppercase">
          <span>Made with <span className="text-red-500">♥</span> by</span>
          <span className="text-brand mt-0.5">Veerendra, Aman & Avhigyan | GDG BHOPAL</span>
        </div>
      </footer>

      {/* Mobile Footer Credit */}
      <div className="py-5 bg-black border-t border-white/5 lg:hidden text-center shrink-0">
        <p className="text-[9px] font-bold text-slate-500 tracking-[0.2em] uppercase">
          Made with <span className="text-red-500">♥</span> by Veerendra, Aman, and Avhigyan
        </p>
        <p className="text-[10px] font-black text-brand tracking-[0.3em] uppercase mt-2">
          GDG BHOPAL
        </p>
      </div>
    </div>
  );
}
