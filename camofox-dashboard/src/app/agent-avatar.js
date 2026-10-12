'use client';

import { RobotHead } from 'robot-heads';

// Shell / trim / LED colours tuned to the dashboard's violet accent (#7C3AED).
const PALETTE = {
  color: '#5B34C9',
  trimColor: '#B7A4F2',
  screenColor: '#EFE9FF',
};

export const ROBOT_STATUS_LABEL = {
  idle: 'Ready when you are',
  thinking: 'Thinking…',
  searching: 'Scanning the form…',
  listening: 'Waiting for you',
  speaking: 'Talking…',
  working: 'Working in the browser…',
  happy: 'All done!',
  error: 'Something went wrong',
  sleeping: 'Backend offline',
};

/**
 * Pick the robot's face from what the agent is doing right now.
 * `mood` is a short-lived override ('happy' after submit, 'error' after a failure).
 */
export function deriveRobotState({ backendOk, isRunning, currentPrompt, lastLog, mode, mood }) {
  if (backendOk === false) return 'sleeping';
  if (mood) return mood;
  if (currentPrompt) return 'listening';
  if (!isRunning) return 'idle';

  const text = (lastLog || '').toLowerCase();
  if (/scann|navigat|opening|snapshot|scroll|waiting for form|found \d+ question/.test(text)) return 'searching';
  if (mode === 'ai' && /\bai\b|model|answer/.test(text)) return 'thinking';
  if (/attach|upload|receiv|phone|click|typ|fill|select|submit/.test(text)) return 'working';
  return mode === 'ai' ? 'thinking' : 'working';
}

export default function AgentAvatar({ state = 'idle', size = 28, compact = false, ...rest }) {
  return (
    <RobotHead
      state={state}
      size={size}
      shape="rectangle"
      antenna={!compact}
      floorShadow={!compact}
      {...PALETTE}
      {...rest}
    />
  );
}

/** Live status row at the bottom of the chat: animated robot + what it is doing. */
export function AgentStatusRow({ state }) {
  return (
    <div className="flex items-center gap-3 px-1 pt-3 pb-1" aria-live="polite">
      <AgentAvatar state={state} size={40} />
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-[#F5F5F5]">{ROBOT_STATUS_LABEL[state]}</p>
        <p className="text-[10px] uppercase tracking-wider text-[#666666]">Form Agent</p>
      </div>
    </div>
  );
}
