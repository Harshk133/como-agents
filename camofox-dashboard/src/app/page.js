'use client';
import { useState, useEffect, useRef } from 'react';

// IMPORTANT: Change this to your deployed backend URL later (e.g., https://your-app.railway.app)
// For local testing, keep it as http://localhost:3001
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export default function Dashboard() {
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const logsEndRef = useRef(null);

  // Connect to the log stream
  useEffect(() => {
    const eventSource = new EventSource(`${BACKEND_URL}/api/logs`);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLogs(prev => [...prev, data.message]);
    };

    return () => eventSource.close();
  }, []);

  // Auto-scroll to bottom of terminal
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const runAgent = async () => {
    setIsRunning(true);
    setLogs(['🚀 Initializing agent...']);
    try {
      await fetch(`${BACKEND_URL}/api/run`, { method: 'POST' });
    } catch (err) {
      setLogs(prev => [...prev, `❌ Failed to connect to backend: ${err.message}`]);
      setIsRunning(false);
    }
  };

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 font-sans">
      {/* LEFT PANEL: Controls & Status */}
      <div className="w-1/3 p-8 border-r border-gray-800 flex flex-col">
        <h1 className="text-3xl font-bold mb-2 text-blue-400">🦊 Camofox Agent</h1>
        <p className="text-gray-400 mb-8">AI-powered form filling dashboard</p>
        
        <div className="flex-1 bg-gray-900 rounded-xl border border-gray-800 p-6 flex flex-col items-center justify-center shadow-lg">
          <div className={`w-4 h-4 rounded-full mb-4 ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`}></div>
          <h2 className="text-xl font-semibold mb-6">
            Status: {isRunning ? 'Agent is working...' : 'Ready to start'}
          </h2>
          
          <button 
            onClick={runAgent} 
            disabled={isRunning}
            className="w-full px-6 py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-bold text-lg transition-all shadow-md hover:shadow-blue-500/20"
          >
            {isRunning ? 'Running Task...' : '▶ Start Form Filling'}
          </button>

          <div className="mt-8 text-sm text-gray-500 text-center">
            <p>Backend: {BACKEND_URL}</p>
            <p className="mt-2">Tip: Open http://localhost:6080 in another tab to watch the browser visually!</p>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL: Live Terminal */}
      <div className="w-2/3 p-8 flex flex-col">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
          <span className="w-3 h-3 bg-green-500 rounded-full"></span> 
          Live Terminal Output
        </h2>
        <div className="flex-1 bg-black rounded-xl p-6 font-mono text-sm overflow-y-auto border border-gray-800 shadow-inner custom-scrollbar">
          {logs.length === 0 ? (
            <span className="text-gray-600">Waiting for agent to start...</span>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="whitespace-pre-wrap break-words mb-1 text-green-400/90">
                {log}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}