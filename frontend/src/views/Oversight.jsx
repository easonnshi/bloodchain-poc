// Oversight DAO view: the trust layer rendered live. Bonds, scandals,
// review scores and the resulting vote weights per org; investigations
// opened and resolved on-chain; the weighted election with its running
// tally. In simulation mode the full election state machine is local; in
// live mode actions fire real contract calls and the panel shows what the
// status endpoint can read back.

import React, { useState } from "react";
import { motion } from "framer-motion";
import { useStore } from "../lib/store.jsx";
import { ActionButton, Field, inputCls, Badge, Empty } from "../components/ui.jsx";

export default function Oversight() {
  const { oversight, actions, isSim } = useStore();

  if (!oversight) {
    return (
      <div className="p-6">
        <Empty>
          Oversight contract not configured — deploy it (scripts/04-deployOversight.js) and set
          OVERSIGHT_CONTRACT_ID in .env.
        </Empty>
      </div>
    );
  }

  const orgs = Object.values(oversight.orgs ?? {});
  const authorityOrg = oversight.orgs?.[oversight.authority];

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1200px]">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Oversight DAO</h1>
          <p className="mt-1 text-sm text-ink-2 max-w-2xl">
            Economic accountability, on-chain: bonds that slash, scandals that shrink your voice,
            and an elected authority that can itself be voted out.
          </p>
        </div>
        <div className="panel-2 px-3.5 py-2 text-sm">
          <span className="overline mr-2">Current authority</span>
          <span className="font-semibold">{authorityOrg?.name ?? oversight.authority}</span>
        </div>
      </header>

      {/* trust grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {orgs.map((o) => (
          <OrgCard key={o.role ?? o.address} org={o} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <ElectionPanel oversight={oversight} actions={actions} isSim={isSim} />
        <InvestigationsPanel oversight={oversight} actions={actions} isSim={isSim} />
      </div>

      <StaffPanel oversight={oversight} actions={actions} isSim={isSim} />
    </div>
  );
}

function OrgCard({ org }) {
  const weight = org.voteWeight ?? 0;
  const scandalMalus = (org.scandalCount ?? 0) * 2;
  const reviewPart = Math.floor((org.reviewScore ?? 0) / 10);
  const basePart = Math.max(0, weight - reviewPart + scandalMalus - 0) - 0; // base+tenure remainder
  const bondPct = Math.min(100, ((org.bondHbar ?? 0) / 10) * 100);

  return (
    <motion.div
      layout
      className={`panel p-4 space-y-3 relative overflow-hidden ${org.suspended ? "opacity-70" : ""}`}
    >
      {org.suspended && (
        <div className="absolute right-3 top-3 rotate-6 rounded border-2 border-critical px-2 py-0.5 text-xs font-bold text-critical">
          SUSPENDED
        </div>
      )}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{org.name ?? org.role}</span>
          {org.isAuthority && (
            <Badge tone="ledger" icon="⚖" title="Currently holds oversight authority">
              authority
            </Badge>
          )}
        </div>
        <div className="ledger text-[10px] text-ink-3 truncate">{org.address}</div>
      </div>

      {/* bond bar - the collateral slashing bites */}
      <div>
        <div className="flex justify-between text-[11px] mb-1">
          <span className="overline">bond</span>
          <span className="ledger text-ink-2">{org.bondHbar ?? "—"} ℏ</span>
        </div>
        <div className="h-2 rounded-full bg-surface-3 overflow-hidden" role="img" aria-label={`bond ${org.bondHbar} of 10 HBAR`}>
          <motion.div
            layout
            className={`h-full rounded-full ${bondPct < 25 ? "bg-critical" : bondPct < 100 ? "bg-warn" : "bg-series-1"}`}
            animate={{ width: `${bondPct}%` }}
            transition={{ type: "spring", stiffness: 80, damping: 20 }}
          />
        </div>
        {bondPct < 100 && (
          <div className="mt-0.5 text-[10px] text-ink-3">slashed below the 10 ℏ minimum</div>
        )}
      </div>

      {/* weight breakdown - the formula, visible */}
      <div>
        <div className="flex justify-between text-[11px] mb-1">
          <span className="overline">vote weight</span>
          <span className="ledger font-bold text-ink">{weight}</span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden bg-surface-3" role="img" aria-label={`vote weight ${weight}`}>
          <div className="bg-series-1" style={{ width: `${basePart * 3}%` }} title={`base + tenure: ${basePart}`} />
          <div className="bg-series-2 ml-px" style={{ width: `${reviewPart * 3}%` }} title={`reviews: +${reviewPart}`} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-ink-3">
          <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-series-1 mr-0.5" />base+tenure {basePart}</span>
          <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-series-2 mr-0.5" />reviews +{reviewPart}</span>
          {scandalMalus > 0 && <span className="text-critical">scandals −{scandalMalus}</span>}
        </div>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-ink-3">
        <span>
          review <span className="ledger text-ink-2">{org.reviewScore ?? "—"}</span>/100
        </span>
        <span className="flex items-center gap-1">
          scandals
          {org.scandalCount > 0 ? (
            <span className="flex gap-0.5" title={`${org.scandalCount} guilty verdict(s)`}>
              {Array.from({ length: Math.min(org.scandalCount, 5) }).map((_, i) => (
                <span key={i} className="h-1.5 w-1.5 rounded-full bg-critical" />
              ))}
            </span>
          ) : (
            <span className="text-good">none</span>
          )}
        </span>
      </div>
    </motion.div>
  );
}

function ElectionPanel({ oversight, actions, isSim }) {
  const el = oversight.election;
  const orgs = oversight.orgs ?? {};
  const roles = Object.keys(orgs);
  const [candidates, setCandidates] = useState(["BANK", "LAB"]);

  const tally = {};
  if (el?.votes) for (const v of el.votes) tally[v.candidate] = (tally[v.candidate] || 0) + v.weight;
  const maxTally = Math.max(1, ...Object.values(tally));

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="overline">Weighted election</span>
        {el?.open ? (
          <Badge tone="warn" icon="●">
            election #{el.id} open
          </Badge>
        ) : (
          <Badge tone="neutral">no open election</Badge>
        )}
      </div>

      {el?.open ? (
        <>
          <div className="space-y-2">
            {el.candidates.map((c) => (
              <div key={c}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium">{orgs[c]?.name ?? c}</span>
                  <span className="ledger text-ink-2">{tally[c] ?? 0} weighted votes</span>
                </div>
                <div className="h-2.5 rounded-full bg-surface-3 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-series-1"
                    animate={{ width: `${((tally[c] ?? 0) / maxTally) * 100}%` }}
                    transition={{ type: "spring", stiffness: 90, damping: 20 }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-hairline pt-2 space-y-1.5">
            <div className="overline">Cast votes (each org signs its own)</div>
            <div className="flex flex-wrap gap-1.5">
              {roles.map((voter) =>
                el.candidates.map((cand) => {
                  const voted = el.votes?.some((v) => v.voter === voter);
                  return (
                    <ActionButton
                      key={`${voter}-${cand}`}
                      small
                      disabled={voted || (orgs[voter]?.voteWeight ?? 0) === 0}
                      onClick={() => actions.castVote(voter, cand)}
                    >
                      {voter} → {cand} <span className="ledger opacity-70">w{orgs[voter]?.voteWeight}</span>
                    </ActionButton>
                  );
                })
              )}
            </div>
            <ActionButton tone="primary" small onClick={() => actions.closeElection("BANK")}>
              Close election → hand over authority
            </ActionButton>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => (
              <label key={r} className="flex items-center gap-1.5 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={candidates.includes(r)}
                  onChange={(e) =>
                    setCandidates(e.target.checked ? [...candidates, r] : candidates.filter((c) => c !== r))
                  }
                  className="accent-crimson"
                />
                {orgs[r]?.name ?? r}
              </label>
            ))}
          </div>
          <ActionButton small onClick={() => actions.startElection(candidates, "BANK")} disabled={candidates.length < 2}>
            Start election
          </ActionButton>
          {!isSim && (
            <p className="text-[11px] text-ink-3">
              Live mode: tallies live on-chain in the contract's <span className="ledger">tally</span>{" "}
              mapping; this panel drives the calls and shows the authority handover on close.
            </p>
          )}
        </>
      )}
      <p className="text-[11px] text-ink-3 leading-4">
        weight = 10 + 2·tenure(months) + reviews/10 − 2·scandals — computed by the contract at the
        moment of voting. A freshly-penalized org votes with a visibly smaller voice.
      </p>
    </div>
  );
}

function InvestigationsPanel({ oversight, actions, isSim }) {
  const [subject, setSubject] = useState("HOSPITAL");
  const [serial, setSerial] = useState("");
  const [reason, setReason] = useState("unit held past limit with no closing event");
  const [penalty, setPenalty] = useState(2);
  const invs = oversight.investigations;

  return (
    <div className="panel p-4 space-y-3">
      <span className="overline">Investigations</span>
      <div className="grid grid-cols-2 gap-2">
        <Field label="subject org">
          <select className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)}>
            {Object.keys(oversight.orgs ?? {}).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="unit serial">
          <input className={`${inputCls} ledger`} value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="e.g. 102" />
        </Field>
      </div>
      <Field label="reason">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ActionButton small tone="warn" onClick={() => actions.openInvestigation(subject, serial || "0", reason, "TRANSPORT")}>
        Open on-chain investigation
      </ActionButton>

      {invs ? (
        <ul className="divide-y divide-grid border-t border-hairline">
          {invs
            .slice()
            .reverse()
            .map((inv) => (
              <li key={inv.id} className="py-2.5 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="ledger text-ink-3">#{inv.id}</span>
                  <span className="font-medium text-ink">{inv.subjectRole}</span>
                  <span className="text-ink-3">unit {inv.serial}</span>
                  {inv.resolved ? (
                    inv.guilty ? (
                      <Badge tone="critical" icon="✕">
                        guilty · {inv.penaltyHbar} ℏ slashed
                      </Badge>
                    ) : (
                      <Badge tone="good" icon="✓">
                        cleared
                      </Badge>
                    )
                  ) : (
                    <Badge tone="warn" icon="…">
                      open
                    </Badge>
                  )}
                </div>
                <div className="text-[11px] text-ink-3">{inv.reason}</div>
                {!inv.resolved && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={penalty}
                      onChange={(e) => setPenalty(Number(e.target.value))}
                      className={`${inputCls} w-20 ledger`}
                      aria-label="penalty in HBAR"
                    />
                    <ActionButton small tone="critical" onClick={() => actions.resolveInvestigation(inv.id, true, penalty, "BANK", inv.subjectRole, inv.serial)}>
                      Guilty — slash bond
                    </ActionButton>
                    <ActionButton small onClick={() => actions.resolveInvestigation(inv.id, false, 0, "BANK", inv.subjectRole, inv.serial)}>
                      Cleared
                    </ActionButton>
                  </div>
                )}
              </li>
            ))}
        </ul>
      ) : (
        <p className="text-[11px] text-ink-3">
          Live mode: the investigation list lives in contract storage (see HashScan); this panel
          drives openInvestigation / resolveInvestigation calls.
        </p>
      )}
      <p className="text-[11px] text-ink-3 leading-4">
        Slashing is capped at 20% of the remaining bond per case — graduated punishment, not ruin.
        Suspension only follows a pattern: 5 guilty verdicts or a bond under 2.5 ℏ.
      </p>
    </div>
  );
}

function StaffPanel({ oversight, actions, isSim }) {
  const staff = oversight.staff;
  const [newStaff, setNewStaff] = useState("");
  if (!staff && !isSim) return null;

  return (
    <div className="panel p-4 space-y-3">
      <span className="overline">Staff registry (hash-only on-chain)</span>
      <div className="flex flex-wrap gap-2 items-end">
        <Field label="register staff id">
          <input className={`${inputCls} ledger`} value={newStaff} onChange={(e) => setNewStaff(e.target.value)} placeholder="NURSE-007" />
        </Field>
        <ActionButton small onClick={() => actions.registerStaff("HOSPITAL", newStaff.trim())} disabled={!newStaff.trim()}>
          Register (SHA-256 → chain)
        </ActionButton>
      </div>
      {staff && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(staff).map(([id, s]) => (
            <div key={id} className={`panel-2 px-3 py-2 flex items-center gap-2.5 ${s.suspended ? "border-critical/50" : ""}`}>
              <span className="ledger text-xs text-ink">{id}</span>
              <span className="text-[10px] text-ink-3">{s.employer}</span>
              {s.suspended ? (
                <Badge tone="critical" icon="⛔">
                  suspended
                </Badge>
              ) : (
                <ActionButton small tone="critical" onClick={() => actions.suspendStaff(id, "BANK")}>
                  suspend
                </ActionButton>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-ink-3 leading-4">
        Only SHA-256 hashes touch the ledger — attribution without personal data. A suspended hash
        makes any future result tagged with it rejectable.
      </p>
    </div>
  );
}
