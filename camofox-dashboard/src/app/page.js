'use client';
import { useState, useEffect, useRef } from 'react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backup-procedures-flexibility-cookie.trycloudflare.com';

export default function Dashboard() {
  const [logs, setLogs] = useState([]);
  const [currentPrompt, setCurrentPrompt] = useState(null);
  const [answerInput, setAnswerInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const logsEndRef = useRef(null);

  useEffect(() => {
    const eventSource = new EventSource(`${BACKEND_URL}/api/logs`);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'prompt') {
        setCurrentPrompt(data);
        setLogs(prev => [...prev, `🤖 Agent waiting for input: "${data.question}"`]);
      } else if (data.type === 'done') {
        setIsRunning(false);
        setCurrentPrompt(null);
        setLogs(prev => [...prev, data.message]);
      } else {
        setLogs(prev => [...prev, data.message]);
      }
    };
    return () => eventSource.close();
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const runAgent = async () => {
    setIsRunning(true);
    setLogs(['🚀 Initializing agent...']);
    setCurrentPrompt(null);
    setAnswerInput('');
    try {
      await fetch(`${BACKEND_URL}/api/run`, { method: 'POST' });
    } catch (err) {
      setLogs(prev => [...prev, `❌ Failed to connect: ${err.message}`]);
      setIsRunning(false);
    }
  };

  const submitAnswer = async () => {
    if (!answerInput.trim()) return;
    setLogs(prev => [...prev, `📤 You answered: "${answerInput}"`]);
    try {
      await fetch(`${BACKEND_URL}/api/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: answerInput })
      });
      setAnswerInput(''); // Clear for next question
    } catch (err) {
      setLogs(prev => [...prev, `❌ Failed to send answer: ${err.message}`]);
    }
  };

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 font-sans">
      {/* LEFT PANEL: Live Browser & Input */}
      <div className="w-1/2 flex flex-col border-r border-gray-800">
        <div className="flex-1 bg-black relative">
          {/* Live noVNC Browser View */}
          <iframe 
            src="http://localhost:6080" 
            title="Live Browser"
            className="w-full h-full border-none"
          />
          <div className="absolute top-2 left-2 bg-black/70 px-3 py-1 rounded text-xs text-gray-300 pointer-events-none">
            Live Browser View (Ensure VNC is running on port 6080)
          </div>
        </div>

        {/* Input Area */}
        <div className="p-6 bg-gray-900 border-t border-gray-800">
          {currentPrompt ? (
            <div className="space-y-4">
              <div className="bg-blue-900/30 border border-blue-700/50 p-4 rounded-lg">
                <h3 className="text-blue-300 font-semibold mb-1">🤖 Agent needs your input:</h3>
                <p className="text-white text-lg">{currentPrompt.question}</p>
              </div>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={answerInput}
                  onChange={(e) => setAnswerInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitAnswer()}
                  placeholder="Type your answer here..."
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                <button
                  onClick={submitAnswer}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition-colors"
                >
                  Submit
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500 mb-4">
                {isRunning ? 'Agent is working... waiting for next question.' : 'Ready to start.'}
              </p>
              <button 
                onClick={runAgent} 
                disabled={isRunning}
                className="px-8 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-bold text-lg transition-all"
              >
                {isRunning ? 'Running...' : '▶ Start Form Filling'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: Live Terminal */}
      <div className="w-1/2 p-6 flex flex-col">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
          <span className="w-3 h-3 bg-green-500 rounded-full"></span> 
          Live Terminal Output
        </h2>
        <div className="flex-1 bg-black rounded-xl p-4 font-mono text-sm overflow-y-auto border border-gray-800 shadow-inner">
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