// Static (non-animated) 3D device-network ambient background.
//
// Reproduces the `VantraDashboard.design.html` artboard's `.net-scene-static` /
// `.net-rig-static` treatment: a device-network motif — small glowing node dots
// connected by thin dashed lines — held at a real 3D perspective/rotation so it
// reads with genuine depth. Purely decorative: no JS, no @keyframes, no motion.
//
// It sits as a `position: fixed` layer behind all content (negative z-index);
// the body's layered gradient + dotted grid (see globals.css) sits behind it.

type Node = { left: number; top: number; size: number; color: string };

const LINES: Array<[number, number, number, number]> = [
  [180, 160, 420, 90],
  [420, 90, 700, 180],
  [700, 180, 960, 110],
  [960, 110, 1220, 210],
  [180, 160, 140, 420],
  [700, 180, 640, 460],
  [1220, 210, 1260, 480],
  [140, 420, 420, 520],
  [420, 520, 640, 460],
  [640, 460, 960, 560],
  [960, 560, 1260, 480],
];

const NODES: Node[] = [
  { left: 174, top: 154, size: 12, color: "#34d399" },
  { left: 414, top: 84, size: 14, color: "#34d399" },
  { left: 694, top: 174, size: 11, color: "#34d399" },
  { left: 954, top: 104, size: 12, color: "#fbbf24" },
  { left: 1214, top: 204, size: 11, color: "#34d399" },
  { left: 134, top: 414, size: 10, color: "#6b7280" },
  { left: 634, top: 454, size: 12, color: "#34d399" },
  { left: 1254, top: 474, size: 11, color: "#34d399" },
  { left: 414, top: 514, size: 13, color: "#34d399" },
  { left: 954, top: 554, size: 11, color: "#f87171" },
];

export function DeviceNetworkBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ perspective: "1600px", zIndex: -1 }}
    >
      <div
        className="absolute inset-0"
        style={{
          transformStyle: "preserve-3d",
          transform: "rotateX(10deg) rotateY(24deg)",
          opacity: 0.55,
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 1440 900"
          preserveAspectRatio="none"
          className="absolute inset-0"
        >
          {LINES.map(([x1, y1, x2, y2], i) => (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#4f46e5"
              strokeWidth={1.4}
              strokeDasharray="6 4"
            />
          ))}
        </svg>
        {NODES.map((node, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              left: node.left,
              top: node.top,
              width: node.size,
              height: node.size,
              background: node.color,
              // Soft glow so nodes read as "lights", not flat dots.
              boxShadow: `0 0 12px 3px ${node.color}55`,
            }}
          />
        ))}
      </div>
    </div>
  );
}