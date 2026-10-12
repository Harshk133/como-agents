'use client';

import { useEffect, useState } from 'react';
import { BorderBeam } from 'border-beam';
import AgentAvatar, { ROBOT_STATUS_LABEL } from './agent-avatar';

// One scripted run of the agent, looped on the landing page.
const SCRIPT = [
  { state: 'searching', role: 'tool', text: 'form.scan — found 4 questions on page 1' },
  { state: 'listening', role: 'agent', text: 'What is your full name?' },
  { state: 'working', role: 'user', text: 'Aarav Sharma' },
  { state: 'listening', role: 'agent', text: 'Upload your marksheet — scan the QR with your phone.' },
  { state: 'working', role: 'tool', text: 'phone.attach — marksheet.pdf (1.2 MB)' },
  { state: 'thinking', role: 'tool', text: 'ai.answer — 2 multiple-choice questions' },
  { state: 'happy', role: 'system', text: 'Form submitted. All required fields filled.' },
];

const STEP_MS = 2400;
const VISIBLE = 4;

function Line({ item }) {
  if (item.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-2xl rounded-br-md bg-[#7C3AED] px-3 py-2 text-[12px] text-white">
          {item.text}
        </p>
      </div>
    );
  }
  if (item.role === 'tool') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#292929] bg-[#0B0B0B] px-2.5 py-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#7C3AED]/20 text-[9px] text-[#8B5CF6]">
          ⚡
        </span>
        <p className="truncate font-mono text-[11px] text-[#A1A1A1]">{item.text}</p>
      </div>
    );
  }
  const tone =
    item.role === 'system'
      ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-200/90'
      : 'border-[#292929] bg-[#151515] text-[#F5F5F5]';
  return (
    <div className="flex items-end gap-2">
      <AgentAvatar state="idle" size={20} compact paused interactive={false} className="mb-0.5 shrink-0" />
      <p className={`max-w-[80%] rounded-2xl rounded-bl-md border px-3 py-2 text-[12px] ${tone}`}>
        {item.text}
      </p>
    </div>
  );
}

export default function LandingDemo() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % (SCRIPT.length + 1)), STEP_MS);
    return () => clearInterval(id);
  }, []);

  // step === SCRIPT.length is a short pause on the finished run before looping.
  const shown = SCRIPT.slice(0, Math.min(step + 1, SCRIPT.length));
  const current = shown[shown.length - 1];

  return (
    <div className="relative w-full max-w-md">
      <div
        aria-hidden
        className="absolute -inset-10 -z-10 rounded-full bg-[#7C3AED]/20 blur-3xl"
      />
      <BorderBeam>
        <div className="rounded-2xl border border-[#292929] bg-[#111111]/95 shadow-2xl shadow-black/60">
          <div className="flex items-center gap-1.5 border-b border-[#292929] px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[#292929]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#292929]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#292929]" />
            <p className="ml-3 truncate font-mono text-[10px] text-[#666666]">
              docs.google.com/forms/…/viewform
            </p>
          </div>

          <div className="flex h-[260px] flex-col justify-end gap-2.5 overflow-hidden px-4 py-4">
            {shown.slice(-VISIBLE).map((item, i) => (
              <div
                key={`${step}-${i}-${item.text}`}
                className={i === Math.min(VISIBLE, shown.length) - 1 ? 'landing-pop' : ''}
              >
                <Line item={item} />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 border-t border-[#292929] px-4 py-3">
            <AgentAvatar state={current.state} size={40} aria-label={`Robot, ${current.state}`} />
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-[#F5F5F5]">
                {ROBOT_STATUS_LABEL[current.state]}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-[#666666]">Form Agent · live</p>
            </div>
          </div>
        </div>
      </BorderBeam>
    </div>
  );
}
