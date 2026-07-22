// Step-through visual explainer - the supplementary presentation asset.
// Arrow keys or buttons advance; each beat is one claim the live demo then
// proves. Deliberately minimal: dark stage, one diagram, one sentence.

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const STEPS = [
  {
    title: "A blood unit becomes a ledger entity",
    body: "At collection, each unit is minted as an NFT on Hedera Token Service. The serial number the network assigns is the unit's identity for life — nobody can mint a duplicate or edit it afterward.",
    scene: "mint",
  },
  {
    title: "Every event lands on consensus",
    body: "Test results, hand-offs, alerts: each one is a Hedera Consensus Service message, timestamped and ordered by the network. The log can be appended to — never edited, never reordered, by anyone.",
    scene: "log",
  },
  {
    title: "The gate is a contract, not a promise",
    body: "transferCustody() must call requireClearance() on the BloodUnitGate contract. No recorded passing test → the contract reverts → the token physically cannot move. The rule lives on-chain where no single party can quietly skip it.",
    scene: "gate",
  },
  {
    title: "One bad unit recalls the whole batch",
    body: "flagBatch() finds every sibling from the same donation and quarantines them in one sweep — including units already transferred away. An instant, automatic product recall.",
    scene: "recall",
  },
  {
    title: "Silence is a signal",
    body: "Every legitimate unit ends with TRANSFUSED or DISPOSED. A unit held past its holding window with no closing event raises a STALE_ALERT — the detectable signature of possible diversion, flagged automatically and recorded permanently for investigators.",
    scene: "stale",
  },
  {
    title: "Anyone can check",
    body: "The whole trail is on Hedera's public testnet. Scan the QR on a blood bag, replay its history from the mirror node, verify every event on HashScan. You don't have to trust this app — that is the point.",
    scene: "verify",
  },
];

export default function Explainer() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const s = STEPS[step];

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-6 gap-6">
      <div className="flex gap-1.5" role="tablist" aria-label="explainer steps">
        {STEPS.map((_, i) => (
          <button
            key={i}
            onClick={() => setStep(i)}
            aria-label={`step ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${i === step ? "w-8 bg-crimson" : "w-3 bg-surface-3 hover:bg-ink-3"}`}
          />
        ))}
      </div>

      <div className="w-full max-w-3xl">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.3 }}
            className="panel p-8 min-h-[420px] flex flex-col items-center justify-center text-center gap-5"
          >
            <Scene name={s.scene} />
            <h2 className="text-2xl font-semibold tracking-tight max-w-xl">{s.title}</h2>
            <p className="text-sm text-ink-2 max-w-xl leading-6">{s.body}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-3">
        <NavBtn onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0}>
          ← prev
        </NavBtn>
        <span className="ledger text-xs text-ink-3">
          {step + 1} / {STEPS.length}
        </span>
        <NavBtn onClick={() => setStep((x) => Math.min(STEPS.length - 1, x + 1))} disabled={step === STEPS.length - 1}>
          next →
        </NavBtn>
      </div>
    </div>
  );
}

function NavBtn({ children, ...props }) {
  return (
    <button
      {...props}
      className="rounded-md border border-hairline bg-surface-2 px-4 py-1.5 text-sm text-ink-2 hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

// Minimal SVG scenes - one glyph per beat, animated on entry.
function Scene({ name }) {
  const stroke = "var(--color-hairline)";
  const crimson = "var(--color-crimson)";
  const ledger = "var(--color-ledger)";
  const warn = "var(--color-warn)";
  const critical = "var(--color-critical)";

  const drop = (cx, cy, fill = crimson, r = 1) => (
    <path
      d={`M ${cx} ${cy - 7 * r} c ${4.4 * r} 5.6 ${7.2 * r} 9.8 ${7.2 * r} ${13.6 * r} a ${7.2 * r} ${7.2 * r} 0 1 1 ${-14.4 * r} 0 c 0 ${-3.8 * r} ${2.8 * r} ${-8 * r} ${7.2 * r} ${-13.6 * r} Z`}
      fill={fill}
    />
  );

  switch (name) {
    case "mint":
      return (
        <motion.svg width="220" height="120" viewBox="0 0 220 120" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          {drop(60, 55)}
          <motion.path d="M 90 55 H 130" stroke={ledger} strokeWidth="2" strokeDasharray="4 4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.3, duration: 0.6 }} />
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
            <path d="M160 30 185 44v28l-25 14-25-14V44Z" fill="none" stroke={ledger} strokeWidth="2" />
            <text x="160" y="62" textAnchor="middle" fill="var(--color-ink)" fontSize="13" fontFamily="var(--font-mono)" fontWeight="700">
              #101
            </text>
          </motion.g>
        </motion.svg>
      );
    case "log":
      return (
        <svg width="260" height="120" viewBox="0 0 260 120">
          {[0, 1, 2, 3, 4].map((i) => (
            <motion.g key={i} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.18 }}>
              <rect x={18 + i * 46} y="46" width="38" height="28" rx="4" fill="var(--color-surface-3)" stroke={i === 4 ? ledger : stroke} />
              <text x={37 + i * 46} y="64" textAnchor="middle" fill="var(--color-ink-2)" fontSize="10" fontFamily="var(--font-mono)">
                #{i + 1}
              </text>
              {i < 4 && <path d={`M ${56 + i * 46} 60 h 8`} stroke={stroke} strokeWidth="2" />}
            </motion.g>
          ))}
          <motion.circle cx="245" cy="60" r="4" fill={ledger} initial={{ scale: 0 }} animate={{ scale: [0, 1.6, 1] }} transition={{ delay: 1.1, duration: 0.5 }} />
        </svg>
      );
    case "gate":
      return (
        <svg width="260" height="120" viewBox="0 0 260 120">
          <path d="M 20 60 H 105" stroke={stroke} strokeWidth="2" />
          <path d="M 155 60 H 240" stroke={stroke} strokeWidth="2" />
          <motion.path
            d="M130 28l24 12v26c0 15-10.5 26-24 32-13.5-6-24-17-24-32V40Z"
            fill="var(--color-surface-3)"
            stroke={ledger}
            strokeWidth="2.5"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          />
          <motion.g initial={{ x: 0 }} animate={{ x: [0, 62, 62, 50] }} transition={{ delay: 0.6, duration: 1.4, times: [0, 0.5, 0.7, 1] }}>
            {drop(40, 60, critical, 0.8)}
          </motion.g>
          <motion.text x="130" y="66" textAnchor="middle" fill={critical} fontSize="11" fontFamily="var(--font-mono)" fontWeight="700" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.7 }}>
            REVERT
          </motion.text>
        </svg>
      );
    case "recall":
      return (
        <svg width="260" height="120" viewBox="0 0 260 120">
          {[[60, 40], [130, 40], [200, 40]].map(([x, y], i) => (
            <motion.g key={i} initial={{ opacity: 1 }}>
              {drop(x, y, i === 1 ? critical : crimson, 0.8)}
              <motion.circle
                cx={x}
                cy={y + 2}
                r="16"
                fill="none"
                stroke={warn}
                strokeWidth="2"
                strokeDasharray="3 3"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.5 + i * 0.35 }}
              />
            </motion.g>
          ))}
          <motion.path d="M 130 62 V 88 H 60 M 130 88 H 200" stroke={warn} strokeWidth="1.5" strokeDasharray="4 3" fill="none" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.4, duration: 0.8 }} />
          <text x="130" y="108" textAnchor="middle" fill={warn} fontSize="10" fontFamily="var(--font-mono)">
            BATCH_ALERT × siblings
          </text>
        </svg>
      );
    case "stale":
      return (
        <svg width="260" height="120" viewBox="0 0 260 120">
          {drop(70, 55, crimson, 0.9)}
          <motion.circle
            cx="70"
            cy="57"
            r="22"
            fill="none"
            stroke={warn}
            strokeWidth="2"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.3, 1] }}
            transition={{ delay: 0.4, duration: 1.6, repeat: Infinity }}
          />
          {/* the clock the holding window runs on */}
          <circle cx="170" cy="45" r="18" fill="none" stroke={stroke} strokeWidth="2" />
          <motion.line
            x1="170" y1="45" x2="170" y2="32"
            stroke="var(--color-ink-2)" strokeWidth="2" strokeLinecap="round"
            style={{ transformOrigin: "170px 45px" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          />
          <motion.text
            x="170" y="90" textAnchor="middle" fill={warn} fontSize="11"
            fontFamily="var(--font-mono)" fontWeight="700"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.0 }}
          >
            STALE_ALERT
          </motion.text>
          <motion.text x="170" y="106" textAnchor="middle" fill="var(--color-ink-3)" fontSize="9" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }}>
            no closing event inside the window
          </motion.text>
        </svg>
      );
    case "verify":
      return (
        <svg width="260" height="120" viewBox="0 0 260 120">
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {[0, 1, 2, 3, 4].map((r) =>
              [0, 1, 2, 3, 4].map((c) => (
                <rect key={`${r}${c}`} x={30 + c * 9} y={35 + r * 9} width="7" height="7" fill={(r * 5 + c) % 3 === 0 || r === 0 || c === 0 ? "var(--color-ink)" : "transparent"} />
              ))
            )}
          </motion.g>
          <motion.path d="M 90 60 H 140" stroke={ledger} strokeWidth="2" strokeDasharray="4 4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.4, duration: 0.6 }} />
          <motion.g initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
            <rect x="150" y="38" width="84" height="44" rx="6" fill="var(--color-surface-3)" stroke={ledger} />
            <text x="192" y="56" textAnchor="middle" fill="var(--color-ink)" fontSize="10" fontFamily="var(--font-mono)">
              hashscan.io
            </text>
            <text x="192" y="72" textAnchor="middle" fill={ledger} fontSize="10" fontFamily="var(--font-mono)">
              ✓ verified
            </text>
          </motion.g>
        </svg>
      );
    default:
      return null;
  }
}
