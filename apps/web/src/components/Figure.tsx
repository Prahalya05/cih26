// Puzzle pictures drawn from data, so the games need no image files and work offline.
//   gears: a row of touching gears        lever: a seesaw with weights        shape: cells on a grid

export type FigureSpec =
  | { type: "gears"; sizes: number[]; first?: "cw" | "ccw"; ask?: "last"; labels?: boolean }
  | { type: "lever"; left: [number, number]; right: [number, number] }
  | { type: "shape"; cells: [number, number][] };

const INK = "#1c1917";
const BRAND = "#0f766e";
const SOFT = "#ccfbf1";

export function Figure({ spec }: { spec: FigureSpec }) {
  if (spec.type === "gears") return <Gears spec={spec} />;
  if (spec.type === "lever") return <Lever spec={spec} />;
  return <ShapeGrid cells={spec.cells} cell={26} className="mx-auto" />;
}

function Gears({ spec }: { spec: Extract<FigureSpec, { type: "gears" }> }) {
  const pad = 10;
  const xs: number[] = [];
  let x = pad + spec.sizes[0];
  spec.sizes.forEach((r, i) => {
    if (i > 0) x += spec.sizes[i - 1] + r + 2;
    xs.push(x);
  });
  const width = xs[xs.length - 1] + spec.sizes[spec.sizes.length - 1] + pad;
  const height = Math.max(...spec.sizes) * 2 + 2 * pad + 18;
  const cy = pad + Math.max(...spec.sizes);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mx-auto w-full max-w-sm" role="img" aria-label="gears">
      {spec.sizes.map((r, i) => (
        <g key={i}>
          <circle cx={xs[i]} cy={cy} r={r} fill={i === 0 ? SOFT : "#fff"} stroke={INK} strokeWidth={4}
            strokeDasharray="5 4" />
          <circle cx={xs[i]} cy={cy} r={r - 6} fill="none" stroke={INK} strokeWidth={1.5} />
          <circle cx={xs[i]} cy={cy} r={3} fill={INK} />
          {i === 0 && spec.first && (
            <text x={xs[i]} y={cy + 6} textAnchor="middle" fontSize={18} fill={BRAND} fontWeight={700}>{spec.first === "cw" ? "↻" : "↺"}</text>
          )}
          {spec.ask === "last" && i === spec.sizes.length - 1 && (
            <text x={xs[i]} y={cy + 6} textAnchor="middle" fontSize={18} fill={INK} fontWeight={700}>?</text>
          )}
          {spec.labels && (
            <text x={xs[i]} y={cy + r + 16} textAnchor="middle" fontSize={13} fill={INK} fontWeight={600}>{"ABCDE"[i]}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

function Lever({ spec }: { spec: Extract<FigureSpec, { type: "lever" }> }) {
  const mid = 150, plankY = 70, unit = 30;
  const weight = (side: -1 | 1, [w, d]: [number, number]) => {
    const cx = mid + side * d * unit;
    const size = 22 + w * 5;
    return (
      <g>
        <rect x={cx - size / 2} y={plankY - size} width={size} height={size} rx={3} fill={side < 0 ? SOFT : "#fef3c7"} stroke={INK} strokeWidth={2} />
        <text x={cx} y={plankY - size / 2 + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={INK}>{w}kg</text>
      </g>
    );
  };
  return (
    <svg viewBox="0 0 300 112" className="mx-auto w-full max-w-sm" role="img" aria-label="seesaw">
      <rect x={mid - 4 * unit - 10} y={plankY} width={8 * unit + 20} height={7} rx={3} fill="#a8a29e" />
      <polygon points={`${mid},${plankY + 7} ${mid - 16},${plankY + 37} ${mid + 16},${plankY + 37}`} fill={INK} />
      {[1, 2, 3, 4].map((d) => (
        <g key={d}>
          <line x1={mid - d * unit} x2={mid - d * unit} y1={plankY + 9} y2={plankY + 15} stroke={INK} />
          <line x1={mid + d * unit} x2={mid + d * unit} y1={plankY + 9} y2={plankY + 15} stroke={INK} />
        </g>
      ))}
      {weight(-1, spec.left)}
      {weight(1, spec.right)}
    </svg>
  );
}

export function ShapeGrid({ cells, cell = 18, className = "" }: { cells: [number, number][]; cell?: number; className?: string }) {
  const w = Math.max(...cells.map(([x]) => x)) + 1;
  const h = Math.max(...cells.map(([, y]) => y)) + 1;
  return (
    <svg viewBox={`-2 -2 ${w * cell + 4} ${h * cell + 4}`} width={w * cell + 4} height={h * cell + 4} className={className} role="img" aria-label="shape">
      {cells.map(([x, y]) => (
        <rect key={`${x},${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={BRAND} stroke="#fff" strokeWidth={2} rx={2} />
      ))}
    </svg>
  );
}
