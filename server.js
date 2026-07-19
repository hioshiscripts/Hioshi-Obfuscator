const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const rateLimit = require('express-rate-limit');
const { nanoid } = require('nanoid');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const execFileAsync = promisify(execFile);

// ---------- Supabase client ----------
// SUPABASE_URL and SUPABASE_SERVICE_KEY come from Render's environment
// variables (Render dashboard -> your service -> Environment). Never hardcode
// these here or commit them to GitHub.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: WebSocket } }
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

// ---------- Obfuscation via Prometheus CLI ----------
// Prometheus (https://github.com/prometheus-lua/Prometheus) is pure Lua, so
// we shell out to the installed CLI rather than calling it as an npm package.
// Attribution below is required by the Prometheus License.
const PROMETHEUS_ATTRIBUTION =
  '-- Based on Prometheus by Elias Oelschner, https://github.com/prometheus-lua/Prometheus\n';

const PRESET_MAP = {
  minify: 'Minify',
  weak: 'Weak',
  medium: 'Medium',
  strong: 'Strong'
};

async function obfuscate(code, preset) {
  const cliPreset = PRESET_MAP[preset] || 'Medium';
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hioshi-'));
  const inputPath = path.join(tmpDir, 'input.lua');
  const outputPath = path.join(tmpDir, 'input.obfuscated.lua');

  try {
    await fs.writeFile(inputPath, code, 'utf8');

    await execFileAsync('lua5.1', ['/opt/prometheus/cli.lua', '--preset', cliPreset, inputPath], {
      cwd: '/opt/prometheus',
      timeout: 15000
    });

    const output = await fs.readFile(outputPath, 'utf8');
    return PROMETHEUS_ATTRIBUTION + output;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
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

    let output;
    try {
      output = await obfuscate(code, preset);
    } catch (obfErr) {
      console.error('Prometheus CLI error:', obfErr.message);
      return res.status(500).json({ error: 'Obfuscation failed. Check that your script is valid Lua.' });
    }

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
