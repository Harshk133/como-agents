import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 1. STRICT CORS CONFIGURATION (cors middleware automatically handles OPTIONS preflight)
app.use(cors({ 
  origin: '*', 
  methods: ['GET', 'POST', 'OPTIONS'], 
  allowedHeaders: ['Content-Type', 'Cache-Control'] 
}));
// NOTE: Removed app.options('*', cors()) because it crashes newer Express versions!

app.use(express.json());

let clients = [];
let currentAgent = null;

// 2. SSE Endpoint
app.get('/api/logs', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Type', 'text/event-stream');
  res.flushHeaders();
  
  clients.push(res);
  console.log('📡 New client connected to logs.');
  
  req.on('close', () => {
    clients = clients.filter(client => client !== res);
  });
});

// 3. Trigger Endpoint
app.post('/api/run', async (req, res) => {
  console.log('📩 Received /api/run request. Spawning interactive agent...');
  res.json({ status: 'started' });
  
  currentAgent = spawn('node', ['interactive-agent.js'], { 
    cwd: __dirname,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['pipe', 'pipe', 'pipe'] // Crucial: allows us to write to stdin
  });
  
  currentAgent.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('@@PROMPT@@')) {
        const parts = trimmed.replace('@@PROMPT@@', '').split('|');
        const ref = parts[0];
        const question = parts.slice(1).join('|');
        console.log('📡 Forwarding prompt to frontend:', question);
        clients.forEach(client => {
          client.write(`data: ${JSON.stringify({ type: 'prompt', ref, question })}\n\n`);
        });
      } else if (trimmed.startsWith('@@LOG@@')) {
        const msg = trimmed.replace('@@LOG@@', '');
        console.log('📤 Agent:', msg);
        clients.forEach(client => {
          client.write(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`);
        });
      } else if (trimmed.startsWith('@@ERROR@@')) {
        const msg = trimmed.replace('@@ERROR@@', '');
        console.error('❌ Agent Error:', msg);
        clients.forEach(client => {
          client.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
        });
      } else if (trimmed === '@@DONE@@') {
        console.log('🏁 Agent finished.');
        clients.forEach(client => {
          client.write(`data: ${JSON.stringify({ type: 'done', message: '✅ Task completed successfully!' })}\n\n`);
        });
        currentAgent = null;
      } else {
        clients.forEach(client => {
          client.write(`data: ${JSON.stringify({ type: 'log', message: trimmed })}\n\n`);
        });
      }
    }
  });

  currentAgent.on('error', (err) => {
    console.error('💥 SPAWN ERROR:', err);
  });
});

// 4. Answer Endpoint (Receives input from your website)
app.post('/api/answer', (req, res) => {
  const { answer } = req.body;
  if (currentAgent && currentAgent.stdin) {
    console.log(' Sending answer to agent:', answer);
    currentAgent.stdin.write(answer + '\n'); // Send answer + newline to trigger readline
    res.json({ status: 'sent' });
  } else {
    res.status(500).json({ error: 'No active agent to receive answer' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Dashboard Backend running on port ${PORT}`));