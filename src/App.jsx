import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────
const LANGUAGES = [
  { code: 'English', label: 'English' },
  { code: 'Hindi',   label: 'हिन्दी' },
  { code: 'Telugu',  label: 'తెలుగు' },
];

// ─── Toast hook ───────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState(null); // { msg, type }
  const timerRef = useRef(null);

  const show = useCallback((msg, type = 'info') => {
    setToast({ msg, type });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), 4500);
  }, []);

  return [toast, show];
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [lang,        setLang]        = useState('English');
  const [status,      setStatus]      = useState('idle');   // idle | connecting | live | error
  const [orbState,    setOrbState]    = useState('idle');   // idle | listening | thinking | speaking
  const [messages,    setMessages]    = useState([]);
  const [timer,       setTimer]       = useState(0);
  const [toast,       showToast]      = useToast();

  const pcRef         = useRef(null);   // RTCPeerConnection
  const channelRef    = useRef(null);   // RTCDataChannel
  const streamRef     = useRef(null);   // MediaStream (microphone)
  const audioRef      = useRef(null);   // <audio> for remote playback
  const analyserRef   = useRef(null);   // AnalyserNode
  const audioCtxRef   = useRef(null);
  const rafRef        = useRef(null);
  const timerRef      = useRef(null);
  const startedRef    = useRef(null);
  const transcriptRef = useRef(null);
  const [bars, setBars] = useState(() =>
    Array.from({ length: 48 }, (_, i) => 6 + Math.round(Math.sin(i / 3.5) * 5 + Math.random() * 6))
  );

  // ── Auto-scroll transcript ─────────────────────────────────────────────────
  useEffect(() => {
    if (transcriptRef.current)
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [messages]);

  // ── Session timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === 'live') {
      startedRef.current = Date.now();
      timerRef.current = setInterval(
        () => setTimer(Math.floor((Date.now() - startedRef.current) / 1000)),
        500
      );
    } else {
      clearInterval(timerRef.current);
      if (status === 'idle') setTimer(0);
    }
    return () => clearInterval(timerRef.current);
  }, [status]);

  // ── Audio visualiser ───────────────────────────────────────────────────────
  const startMeter = useCallback(async (stream) => {
    audioCtxRef.current ||= new AudioContext();
    if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();
    const src = audioCtxRef.current.createMediaStreamSource(stream);
    const an  = audioCtxRef.current.createAnalyser();
    an.fftSize = 128;
    src.connect(an);
    analyserRef.current = an;
    const data = new Uint8Array(an.frequencyBinCount);
    const tick = () => {
      if (!analyserRef.current) return;
      an.getByteFrequencyData(data);
      const avg = data.reduce((s, v) => s + v, 0) / data.length;
      setBars(prev => prev.map((_, i) =>
        Math.max(4, Math.round(7 + (avg / 30) * Math.abs(Math.sin(i * 0.35 + performance.now() / 300)) * 28))
      ));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  // ── Cleanup WebRTC ─────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current  = null;
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    channelRef.current = null;
    if (audioRef.current) { audioRef.current.srcObject = null; audioRef.current.remove(); audioRef.current = null; }
  }, []);

  // ── Handle realtime events from OpenAI data channel ────────────────────────
  const handleEvent = useCallback((ev) => {
    const t = ev.type || '';

    if (t === 'input_audio_buffer.speech_started') setOrbState('listening');
    if (t === 'input_audio_buffer.speech_stopped') setOrbState('thinking');
    if (t === 'response.created')                  setOrbState('speaking');
    if (t === 'response.done')                     setOrbState('idle');

    // User speech transcription
    if (t === 'conversation.item.input_audio_transcription.completed' && ev.transcript?.trim()) {
      setMessages(m => [...m, { id: Date.now() + 'u', role: 'user', text: ev.transcript.trim() }]);
    }

    // Assistant text transcript
    if (t === 'response.audio_transcript.done' && ev.transcript?.trim()) {
      setMessages(m => [...m, { id: Date.now() + 'a', role: 'assistant', text: ev.transcript.trim() }]);
    }

    if (t === 'error') {
      showToast(ev.error?.message || 'An error occurred.', 'error');
    }
  }, [showToast]);

  // ── Connect to OpenAI Realtime via WebRTC ──────────────────────────────────
  const connect = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast('Microphone not available in this browser.', 'error');
      return;
    }

    setStatus('connecting');
    setMessages([]);
    setOrbState('idle');

    try {
      // 1. Get ephemeral token from our server
      const sessionRes = await fetch('/api/session', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ language: lang }),
      });
      if (!sessionRes.ok) {
        const err = await sessionRes.json().catch(() => ({}));
        throw new Error(err.error || `Session error: ${sessionRes.status}`);
      }
      const { token, model } = await sessionRes.json();

      // 2. Microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startMeter(stream);

      // 3. Create RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Add microphone tracks
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      // Remote audio element for Sahaay's voice
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('aria-hidden', 'true');
      document.body.appendChild(audio);
      audioRef.current = audio;
      pc.ontrack = evt => { audio.srcObject = evt.streams[0]; };

      // Data channel for events
      const ch = pc.createDataChannel('oai-events');
      channelRef.current = ch;
      ch.onopen    = () => console.log('[WebRTC] data channel open');
      ch.onmessage = evt => { try { handleEvent(JSON.parse(evt.data)); } catch {} };

      // 4. Create SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering (CRITICAL — without this the SDP has no candidates)
      await new Promise(resolve => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        const onchange = () => {
          if (pc.iceGatheringState === 'complete') {
            pc.removeEventListener('icegatheringstatechange', onchange);
            resolve();
          }
        };
        pc.addEventListener('icegatheringstatechange', onchange);
        setTimeout(resolve, 5000); // 5-second safety fallback
      });

      // 5. Send SDP offer directly to OpenAI using ephemeral token
      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
        {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/sdp' },
          body:    pc.localDescription.sdp,
        }
      );

      if (!sdpRes.ok) {
        const errText = await sdpRes.text();
        throw new Error(`OpenAI WebRTC ${sdpRes.status}: ${errText.slice(0, 200)}`);
      }

      // 6. Set remote description — audio starts flowing
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });

      setStatus('live');
      setOrbState('listening');
      showToast('Connected! Sahaay is listening — start speaking.', 'success');
      console.log('[WebRTC] connected, model:', model);

    } catch (err) {
      console.error('[connect] failed:', err);
      showToast(`Connection failed: ${err.message}`, 'error');
      cleanup();
      setStatus('error');
      setOrbState('idle');
    }
  }, [lang, startMeter, handleEvent, cleanup, showToast]);

  // ── Disconnect ─────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    cleanup();
    setStatus('idle');
    setOrbState('idle');
    showToast('Session ended.', 'info');
  }, [cleanup, showToast]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => () => { cleanup(); clearInterval(timerRef.current); }, [cleanup]);

  // ─── Derived UI state ──────────────────────────────────────────────────────
  const isLive       = status === 'live';
  const isConnecting = status === 'connecting';
  const mins = String(Math.floor(timer / 60)).padStart(2, '0');
  const secs = String(timer % 60).padStart(2, '0');

  const orbLabel =
    isConnecting ? 'Connecting…'    :
    !isLive      ? 'Tap to speak'   :
    orbState === 'listening' ? 'Listening…' :
    orbState === 'thinking'  ? 'Thinking…'  :
    orbState === 'speaking'  ? 'Speaking…'  : 'Ready';

  const statusDot =
    isLive       ? 'dot-live'      :
    isConnecting ? 'dot-loading'   :
    status === 'error' ? 'dot-err' : 'dot-idle';

  const statusText =
    isLive       ? 'Live voice'    :
    isConnecting ? 'Connecting…'   :
    status === 'error' ? 'Error'   : 'Not connected';

  return (
    <div className="shell">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="brand">
          <div className="brand-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </div>
          <span className="brand-name">Sahaay</span>
          <span className="brand-tag">voice</span>
        </div>
        <div className="header-right">
          <div className={`status-badge ${statusDot}`}>
            <span className="status-dot-el" />
            <span>{statusText}</span>
          </div>
          {isLive && (
            <div className="timer-badge">
              {mins}:{secs}
            </div>
          )}
        </div>
      </header>

      {/* ── Main Layout ─────────────────────────────────────────────────── */}
      <main className="main">

        {/* ── Left: Voice Panel ─────────────────────────────────────────── */}
        <section className="voice-panel">
          <div className="section-eyebrow">AI Voice Assistant</div>
          <h1 className="hero-title">
            Speak naturally.<br/>
            <span className="hero-accent">Sahaay listens.</span>
          </h1>
          <p className="hero-sub">
            Book a public clinic appointment by talking — no forms, no menus.
            Just say what you need.
          </p>

          {/* Language selector */}
          <div className="lang-row">
            <span className="lang-label">I speak</span>
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                className={`lang-btn ${lang === l.code ? 'active' : ''}`}
                onClick={() => { if (!isLive) { setLang(l.code); showToast(`Language: ${l.label}`, 'info'); } }}
                disabled={isLive || isConnecting}
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* Voice orb stage */}
          <div className={`stage ${isLive && ['listening','speaking'].includes(orbState) ? 'stage-active' : ''}`}>
            {/* Orbit rings */}
            <div className="ring ring-1" />
            <div className="ring ring-2" />
            <div className="ring ring-3" />

            {/* Glow blob */}
            <div className={`glow ${orbState === 'speaking' ? 'glow-speak' : ''}`} />

            {/* Main orb */}
            <button
              className={`orb ${isLive ? 'orb-live' : ''} ${isConnecting ? 'orb-loading' : ''} orb-${orbState}`}
              onClick={isLive ? disconnect : (isConnecting ? undefined : connect)}
              disabled={isConnecting}
              aria-label={isLive ? 'End session' : 'Start voice session'}
            >
              {/* Mic icon (idle/connecting) */}
              {!isLive && (
                <svg className="orb-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}

              {/* Wave bars (live) */}
              {isLive && (
                <div className={`orb-waves ${orbState}`}>
                  {[0,1,2,3,4].map(i => (
                    <span key={i} className="orb-bar" style={{ animationDelay: `${i * -0.12}s` }} />
                  ))}
                </div>
              )}

              <span className="orb-label">{orbLabel}</span>
            </button>

            {/* Sound bars visualiser */}
            <div className={`visualiser ${isLive ? 'vis-show' : ''}`} aria-hidden="true">
              {bars.map((h, i) => (
                <span
                  key={i}
                  className="vis-bar"
                  style={{ height: `${h}px`, animationDelay: `${(i % 8) * -0.09}s` }}
                />
              ))}
            </div>

            {/* Stage caption */}
            <div className="stage-caption">
              <span className="caption-dot" />
              {isLive
                ? orbState === 'speaking'  ? 'Sahaay is speaking — you can interrupt anytime'
                : orbState === 'listening' ? 'Listening to you — speak naturally'
                : orbState === 'thinking'  ? 'Processing your request…'
                : 'Ready — say something'
                : isConnecting
                ? 'Requesting microphone & connecting to OpenAI…'
                : 'Your voice stays private to this session'}
            </div>
          </div>

          {/* Quick actions */}
          {isLive && (
            <div className="quick-row">
              {[
                { label: 'Book appointment', msg: 'I need to book a clinic appointment.' },
                { label: 'Hear again', msg: 'Please repeat what you just said.' },
                { label: 'Talk to human', msg: 'I want to speak with a human.' },
              ].map(({ label, msg }) => (
                <button
                  key={label}
                  className="quick-btn"
                  onClick={() => {
                    const ch = channelRef.current;
                    if (ch?.readyState === 'open') {
                      ch.send(JSON.stringify({
                        type: 'conversation.item.create',
                        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: msg }] },
                      }));
                      ch.send(JSON.stringify({ type: 'response.create', response: { modalities: ['audio','text'] } }));
                      setMessages(m => [...m, { id: Date.now() + 'q', role: 'user', text: msg }]);
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Right: Conversation Panel ──────────────────────────────────── */}
        <aside className="conv-panel">
          {/* Transcript card */}
          <div className="conv-card">
            <div className="conv-header">
              <div>
                <div className="section-eyebrow">Live Session</div>
                <h2 className="conv-title">Conversation</h2>
              </div>
              {messages.length > 0 && (
                <button className="clear-btn" onClick={() => setMessages([])}>
                  Clear
                </button>
              )}
            </div>

            <div className="transcript" ref={transcriptRef}>
              {messages.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                  </div>
                  <strong>No messages yet</strong>
                  <span>
                    {isLive
                      ? 'Start speaking — your words and Sahaay\'s replies appear here.'
                      : 'Tap the orb to start a live voice session.'}
                  </span>
                </div>
              ) : (
                messages.map(m => (
                  <div key={m.id} className={`msg msg-${m.role}`}>
                    <div className="msg-avatar">{m.role === 'user' ? 'YOU' : 'AI'}</div>
                    <div className="msg-body">
                      <span className="msg-name">{m.role === 'user' ? 'You' : 'Sahaay'}</span>
                      <span className="msg-text">{m.text}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Connection hint */}
            <div className="conv-footer">
              {isLive
                ? <><span className="hint-key">SPACE</span> Start / Stop &nbsp;·&nbsp; <span className="hint-key">Quick actions ↑</span></>
                : 'Tap the orb or press SPACE to connect'}
            </div>
          </div>

          {/* Info card */}
          <div className="info-card">
            <div className="info-icon">✦</div>
            <div>
              <strong>Secure &amp; private</strong>
              <span>Audio goes directly to OpenAI. The server never stores your voice.</span>
            </div>
          </div>
        </aside>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="footer">
        <span>Powered by OpenAI Realtime API · WebRTC voice</span>
        <span>Fictional demo — no real appointments are booked</span>
      </footer>

      {/* ── Toast ───────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`toast toast-${toast.type}`} role="status">
          {toast.type === 'success' && <span>✓</span>}
          {toast.type === 'error'   && <span>✕</span>}
          {toast.type === 'info'    && <span>ℹ</span>}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
