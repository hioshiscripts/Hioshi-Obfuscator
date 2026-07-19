const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { nanoid } = require('nanoid');
const { createClient } = require('@supabase/supabase-js');

// ---------- Supabase client ----------
// SUPABASE_URL and SUPABASE_SERVICE_KEY come from Render's environment
// variables (Render dashboard -> your service -> Environment). Never hardcode
// these here or commit them to GitHub.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Rate limiting ----------
const obfuscateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests. Try again in a minute.' }
});

// ---------- Obfuscation stub ----------
// Plug your actual Prometheus/Lua-Hider transform in here. Keeping it as a
// separate function makes it easy to swap out later without touching routes.
function obfuscate(code, preset) {
  // TODO: replace with real Prometheus obfuscator call
  const banner = `-- protected by Hioshi Obfuscator (${preset})\n`;
  return banner + code;
}

// ---------- POST /obfuscate ----------
// Body: { code: string, preset: 'minify' | 'weak' | 'medium' | 'strong' }
// Saves the obfuscated script in Supabase and returns a raw link + id.
app.post('/obfuscate', obfuscateLimiter, async (req, res) => {
  try {
    const { code, preset = 'medium' } = req.body;

    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'No code provided.' });
    }

    const validPresets = ['minify', 'weak', 'medium', 'strong'];
    if (!validPresets.includes(preset)) {
      return res.status(400).json({ error: 'Invalid preset.' });
    }

    const output = obfuscate(code, preset);
    const id = nanoid(10);

    const { error } = await supabase
      .from('scripts')
      .insert({ id, content: output, preset });

    if (error) {
      console.error('Supabase insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save script.' });
    }

    res.json({
      id,
      raw_url: `${req.protocol}://${req.get('host')}/raw/${id}`
    });
  } catch (err) {
    console.error('Obfuscate error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---------- GET /raw/:id ----------
// Roblox HttpService/loadstring requests get the real script.
// Everyone else gets the Access Denied page.
app.get('/raw/:id', async (req, res) => {
  try {
    const userAgent = req.headers['user-agent'] || '';
    const isRoblox = /Roblox/i.test(userAgent);

    const { data, error } = await supabase
      .from('scripts')
      .select('content')
      .eq('id', req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).send('Not found');
    }

    if (isRoblox) {
      res.set('Content-Type', 'text/plain');
      return res.status(200).send(data.content);
    }

    return res.status(403).sendFile(path.join(__dirname, 'public', 'access-denied.html'));
  } catch (err) {
    console.error('Raw route error:', err);
    res.status(500).send('Server error');
  }
});

// ---------- Fallback: serve the main site ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Hioshi Obfuscator running on port ${PORT}`);
});
