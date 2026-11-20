// A small stroke icon set (24 px grid, 1.8 px stroke) used for interface chrome instead of emoji.
// Emoji stay only where they are the picture itself (interest cards, avatars), which low-literacy users rely on.

const P: Record<string, string[]> = {
  back: ["M19 12H5", "M12 19l-7-7 7-7"],
  next: ["M5 12h14", "M12 5l7 7-7 7"],
  chevron: ["m9 18 6-6-6-6"],
  chevronDown: ["m6 9 6 6 6-6"],
  speaker: ["M11 5 6 9H2v6h4l5 4V5z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14"],
  check: ["M20 6 9 17l-5-5"],
  x: ["M18 6 6 18", "M6 6l12 12"],
  camera: ["M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z", "M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  video: ["m22 8-6 4 6 4V8z", "M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"],
  lock: ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z", "M7 11V7a5 5 0 0 1 10 0v4"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "m9 12 2 2 4-4"],
  eyeOff: ["M9.9 4.2A9.6 9.6 0 0 1 12 4c7 0 10 8 10 8a17 17 0 0 1-2.2 3.3", "M6.6 6.6A17 17 0 0 0 2 12s3 8 10 8a9.6 9.6 0 0 0 5.4-1.6", "M9.9 9.9a3 3 0 0 0 4.2 4.2", "m2 2 20 20"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.9", "M16 3.1a4 4 0 0 1 0 7.8"],
  teacher: ["M4 4h16v11H4z", "M8 21l4-6 4 6", "M8 9h8", "M8 12h5"],
  chart: ["M3 3v18h18", "M18 17V9", "M13 17V5", "M8 17v-3"],
  briefcase: ["M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z", "M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"],
  target: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z", "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  star: ["M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2 2 9.3l6.9-1z"],
  spark: ["M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.4l-1.9-5.8L4 10.7l6.1-1.9z"],
  refresh: ["M3 12a9 9 0 0 1 15-6.7L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-15 6.7L3 16", "M8 16H3v5"],
  offline: ["m2 2 20 20", "M8.5 16.5a5 5 0 0 1 7 0", "M12 20h.01", "M5 12.9a10 10 0 0 1 5.2-2.7", "M19 12.9a10 10 0 0 0-2.3-1.5", "M2 8.8a15 15 0 0 1 4.2-2.6", "M22 8.8A15 15 0 0 0 10.7 5"],
  sync: ["M7 20V4", "M3 8l4-4 4 4", "M17 4v16", "M13 16l4 4 4-4"],
  alert: ["M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", "M12 9v4", "M12 17h.01"],
  mic: ["M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z", "M19 10v1a7 7 0 0 1-14 0v-1", "M12 18v4"],
  stop: ["M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"],
  play: ["M6 4l14 8-14 8z"],
  plus: ["M12 5v14", "M5 12h14"],
  flask: ["M9 3h6", "M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3", "M7 15h10"],
  trash: ["M3 6h18", "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"],
  clipboard: ["M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z", "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2", "m9 14 2 2 4-4"],
  wrench: ["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"],
  cap: ["M22 10 12 5 2 10l10 5z", "M6 12v5c3 3 9 3 12 0v-5", "M22 10v6"],
  wallet: ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],
  idcard: ["M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M8 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M14 10h4", "M14 14h4"],
  link: ["M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"],
  share: ["M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8", "M16 6l-4-4-4 4", "M12 2v13"],
  ban: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "m4.9 4.9 14.2 14.2"],
  up: ["M7 10v12", "M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z"],
  down: ["M17 14V2", "M9 18.1 10 14H4.2a2 2 0 0 1-1.9-2.6l2.3-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9z"],
  bot: ["M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z", "M12 8V4", "M9 14h.01", "M15 14h.01"],
  scan: ["M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", "M9 9.5h.01", "M15 9.5h.01", "M8.5 14.5s1.3 1.5 3.5 1.5 3.5-1.5 3.5-1.5"],
  phone: ["M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M12 18h.01"],
  steps: ["M3 20h5v-5h5v-5h5V5h3"],
  pencil: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 16v-4", "M12 8h.01"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  award: ["M12 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12z", "M15.5 12.9 17 22l-5-3-5 3 1.5-9.1"],
  bulb: ["M9 18h6", "M10 22h4", "M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"],
  question: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
  hourglass: ["M5 22h14", "M5 2h14", "M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22", "M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"],
  keyboard: ["M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01", "M8 16h8"],
  send: ["m22 2-7 20-4-9-9-4z", "M22 2 11 13"],
  chain: ["M9 17H7A5 5 0 0 1 7 7h2", "M15 7h2a5 5 0 0 1 0 10h-2", "M8 12h8"],
  layers: ["m12 2 10 5-10 5L2 7z", "m2 17 10 5 10-5", "m2 12 10 5 10-5"],
};

export type IconName = keyof typeof P;

export function Icon({ name, className = "size-5", strokeWidth = 1.8 }: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`} aria-hidden="true">
      {P[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** The Disha mark from the deck: a compass needle inside an open cyan ring. */
export function Mark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M16 3.5a12.5 12.5 0 1 1-11.3 7.2" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" />
      <path d="M21.5 10.5 17.6 17.6 10.5 21.5 14.4 14.4z" fill="var(--color-brand)" />
      <circle cx="16" cy="16" r="1.6" fill="#fff" />
    </svg>
  );
}
