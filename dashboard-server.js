import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Cache-Control'],
  }),
);

app.use(express.json());

let clients = [];
let currentAgent = null;

function broadcast(payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(line);
  }
}

function parsePromptLine(trimmed) {
  const raw = trimmed.replace('@@PROMPT@@', '');
  try {
    return JSON.parse(raw);
  } catch {
    const parts = raw.split('|');
    return {
      kind: 'field',
      ref: parts[0],
      question: parts.slice(1).join('|'),
    };
  }
}

function handleAgentLine(trimmed) {
  if (!trimmed) return;

  if (trimmed.startsWith('@@PROMPT@@')) {
    const prompt = parsePromptLine(trimmed);
    console.log('📡 Prompt → dashboard:', prompt.question || prompt.kind);
    broadcast({ type: 'prompt', ...prompt });
    return;
  }
  if (trimmed.startsWith('@@LOG@@')) {
    broadcast({ type: 'log', message: trimmed.replace('@@LOG@@', '') });
    return;
  }
  if (trimmed.startsWith('@@ERROR@@')) {
    broadcast({ type: 'error', message: trimmed.replace('@@ERROR@@', '') });
    return;
  }
  if (trimmed === '@@DONE@@') {
    broadcast({ type: 'done', message: '✅ Form filling finished.' });
    currentAgent = null;
    return;
  }
  broadcast({ type: 'log', message: trimmed });
}

function attachAgentStreams(child) {
  const onData = (data) => {
    for (const line of data.toString().split('\n')) {
      handleAgentLine(line.trim());
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
}

function stopCurrentAgent() {
  if (!currentAgent) return;
  try {
    currentAgent.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  currentAgent = null;
}

app.get('/api/logs', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Type', 'text/event-stream');
  res.flushHeaders();

  clients.push(res);
  console.log('📡 Dashboard client connected (SSE).');

  req.on('close', () => {
    clients = clients.filter((client) => client !== res);
  });
});

app.post('/api/run', async (req, res) => {
  const mode = req.body?.mode === 'ai' ? 'ai' : 'manual';
  console.log(`📩 /api/run — spawning smart-agent (${mode} mode)...`);

  stopCurrentAgent();

  const args = ['smart-agent.js'];
  if (mode === 'ai') args.push('--ai');

  const camofoxApiPort = process.env.CAMOFOX_API_PORT || '9377';

  currentAgent = spawn('node', args, {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: camofoxApiPort,
      FORCE_COLOR: '0',
      DASHBOARD_MODE: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  attachAgentStreams(currentAgent);

  currentAgent.on('exit', (code) => {
    if (currentAgent) {
      if (code && code !== 0) {
        broadcast({ type: 'error', message: `Agent exited with code ${code}` });
      }
      currentAgent = null;
    }
  });

  currentAgent.on('error', (err) => {
    broadcast({ type: 'error', message: err.message });
    currentAgent = null;
  });

  res.json({ status: 'started', mode });
});

app.post('/api/answer', (req, res) => {
  const { answer } = req.body;
  if (!answer?.trim()) {
    return res.status(400).json({ error: 'answer is required' });
  }
  if (currentAgent?.stdin) {
    console.log('📤 Answer → agent:', answer);
    currentAgent.stdin.write(`${answer.trim()}\n`);
    return res.json({ status: 'sent' });
  }
  return res.status(500).json({ error: 'No active agent to receive answer' });
});

app.post('/api/stop', (_req, res) => {
  stopCurrentAgent();
  broadcast({ type: 'done', message: 'Agent stopped.' });
  res.json({ status: 'stopped' });
});

const PORT = process.env.DASHBOARD_PORT || process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Dashboard backend on http://localhost:${PORT}`));
