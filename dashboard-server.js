import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors()); // Allow Vercel frontend to connect

let clients = [];

// 1. SSE Endpoint: Frontend connects here to listen for logs
app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  clients.push(res);
  req.on('close', () => {
    clients = clients.filter(client => client !== res);
  });
});

// 2. Trigger Endpoint: Frontend calls this to start the agent
app.post('/api/run', async (req, res) => {
  res.json({ status: 'started' });
  
  // Spawn the smart-agent.js script
  const agent = spawn('node', ['smart-agent.js'], { 
    cwd: __dirname,
    env: { ...process.env, FORCE_COLOR: '0' } // Disable ANSI colors for clean text
  });
  
  agent.stdout.on('data', (data) => {
    const msg = data.toString();
    clients.forEach(client => {
      client.write(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`);
    });
  });
  
  agent.stderr.on('data', (data) => {
    const msg = data.toString();
    clients.forEach(client => {
      client.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
    });
  });
  
  agent.on('close', (code) => {
    clients.forEach(client => {
      client.write(`data: ${JSON.stringify({ type: 'done', message: `\n✅ Task completed (Exit code: ${code})` })}\n\n`);
    });
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Dashboard Backend running on port ${PORT}`));