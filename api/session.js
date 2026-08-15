/**
 * Vercel Serverless Function: POST /api/session
 *
 * Creates an OpenAI Realtime session and returns a short-lived ephemeral
 * client token. The browser uses this token to connect directly to OpenAI
 * WebRTC — this function never proxies audio.
 *
 * Local dev  → handled by server/index.mjs (full Node HTTP server)
 * Production → handled by this Vercel serverless function
 */

const SYSTEM_PROMPT = `You are Sahaay, a warm and patient AI voice assistant that helps users book public clinic appointments.
Keep responses SHORT — one or two sentences maximum. Speak plainly and slowly.
You help elderly, rural, low-literacy, and multilingual users navigate the healthcare system.
Collect: type of appointment, preferred date, patient name, and phone number.
Before confirming, read back all details and ask for an explicit "yes".
Never diagnose, prescribe, or give medical advice. Always offer a human handoff if asked.
This is a demo — any appointments booked are fictional.`;

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const KEY   = process.env.OPENAI_API_KEY;
  const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-mini-realtime-preview';

  if (!KEY) {
    return res.status(503).json({
      error: 'OPENAI_API_KEY is not set. Add it in your Vercel project environment variables.',
    });
  }

  const { language = 'English' } = req.body || {};

  const sessionConfig = {
    model: MODEL,
    modalities: ['audio', 'text'],
    instructions: `${SYSTEM_PROMPT}\nSpeak in ${language}.`,
    voice: 'alloy',
    input_audio_format:  'pcm16',
    output_audio_format: 'pcm16',
    input_audio_transcription: { model: 'whisper-1' },
    turn_detection: {
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 600,
      create_response: true,
    },
    max_response_output_tokens: 256,
  };

  let openaiRes;
  try {
    openaiRes = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sessionConfig),
    });
  } catch (err) {
    console.error('[session] network error:', err.message);
    return res.status(502).json({ error: 'Cannot reach OpenAI. Check your network.' });
  }

  const data = await openaiRes.json();

  if (!openaiRes.ok) {
    console.error('[session] OpenAI error:', JSON.stringify(data));
    return res.status(openaiRes.status).json({
      error: data?.error?.message || 'OpenAI rejected the session request.',
    });
  }

  console.log(`[session] created  model=${MODEL}  language=${language}`);

  return res.status(200).json({
    token:      data.client_secret.value,
    expires_at: data.client_secret.expires_at,
    model:      MODEL,
  });
}
