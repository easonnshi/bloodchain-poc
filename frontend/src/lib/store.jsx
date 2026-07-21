// App-wide state. One provider decides the data mode once:
//
//   live - local API server reachable AND .env configured: actions sign real
//          transactions, events come from the public mirror node.
//   sim  - anything else: the SimEngine plays the same story in-memory,
//          under a permanent SIMULATION badge.
//
// Views never branch on the mode; they call the same `actions` surface and
// render the same shapes either way.

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { recentTopicMessages } from "./mirror.js";
import { SimEngine, SIM_CONFIG, ROLE_NAMES } from "./sim.js";

const StoreContext = createContext(null);

const LIVE_POLL_MS = 6000;

export function StoreProvider({ children }) {
  const [mode, setMode] = useState("connecting"); // connecting | live | sim
  const [config, setConfig] = useState(null);
  const [units, setUnits] = useState([]);
  const [events, setEvents] = useState([]);
  const [oversight, setOversight] = useState(null);
  const [storyState, setStoryState] = useState({ running: false, step: 0, total: 0, caption: null });
  const simRef = useRef(null);

  // ---- mode detection ----------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await Promise.race([
          api.config(),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2500)),
        ]);
        if (cancelled) return;
        if (cfg.configured) {
          setConfig(cfg);
          setMode("live");
          return;
        }
      } catch {
        /* API server not running - fall through to sim */
      }
      if (!cancelled) {
        simRef.current = new SimEngine();
        setConfig(SIM_CONFIG);
        setMode("sim");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- sim subscription --------------------------------------------------
  useEffect(() => {
    if (mode !== "sim") return;
    const sim = simRef.current;
    const sync = () => {
      setUnits(Object.values(sim.units));
      setEvents([...sim.events].reverse()); // newest first, like the mirror feed
      setOversight(sim.oversightStatus());
      setStoryState({ ...sim.story });
    };
    sync();
    return sim.subscribe(sync);
  }, [mode]);

  // ---- live polling ------------------------------------------------------
  useEffect(() => {
    if (mode !== "live") return;
    let stop = false;
    const tick = async () => {
      try {
        const { units: u } = await api.units();
        if (!stop) setUnits(u);
      } catch {
        /* keep last snapshot */
      }
      if (config?.topicId) {
        try {
          const msgs = await recentTopicMessages(config.topicId, 40);
          if (!stop) setEvents(msgs);
        } catch {
          /* mirror hiccup - keep last */
        }
      }
      try {
        const status = await api.oversightStatus();
        if (!stop) {
          // Normalize to the sim shape so views don't care about mode.
          const orgs = {};
          for (const [role, o] of Object.entries(status.orgs || {})) {
            orgs[role] = { role, name: ROLE_NAMES[role] ?? role, ...o };
          }
          setOversight({ authority: status.authority, orgs, election: null, investigations: null });
        }
      } catch {
        if (!stop) setOversight(null); // oversight contract not configured
      }
    };
    tick();
    const iv = setInterval(tick, LIVE_POLL_MS);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [mode, config]);

  const refresh = async () => {
    if (mode !== "live") return;
    try {
      const { units: u } = await api.units();
      setUnits(u);
      if (config?.topicId) setEvents(await recentTopicMessages(config.topicId, 40));
    } catch {
      /* transient */
    }
  };

  // ---- unified action surface -------------------------------------------
  const actions = useMemo(() => {
    const live = mode === "live";
    const sim = () => simRef.current;
    const after = async (result) => {
      if (live) await refresh();
      return result;
    };
    return {
      mint: (batch, center) => (live ? api.mint(batch, center).then(after) : sim().mint(batch, center)),
      submitTest: (serial, passed, staffId, testType) =>
        live ? api.submitTest(serial, passed, staffId, testType).then(after) : sim().submitTest(serial, passed, staffId, testType),
      transfer: (serial, to) => (live ? api.transfer(serial, to).then(after) : sim().transfer(serial, to)),
      close: (serial, reason) => (live ? api.close(serial, reason).then(after) : sim().close(serial, reason)),
      flag: (serial, reason) => (live ? api.flag(serial, reason).then(after) : sim().flag(serial, reason)),
      staleCheck: (thresholdMs) => (live ? api.staleCheck(thresholdMs).then(after) : sim().staleCheck(thresholdMs)),
      drift: () => (live ? api.drift() : Promise.resolve({ drift: [], simulated: true })),
      openInvestigation: (subjectRole, serial, reason, openedByRole) =>
        live
          ? api.openInvestigation(subjectRole, serial, reason, openedByRole).then(after)
          : sim().openInvestigation(subjectRole, serial, reason, openedByRole),
      resolveInvestigation: (id, guilty, penaltyHbar, authorityRole, subjectRole, serial) =>
        live
          ? api.resolveInvestigation(id, guilty, penaltyHbar, authorityRole, subjectRole, serial).then(after)
          : sim().resolveInvestigation(id, guilty, penaltyHbar),
      suspendStaff: (staffId, authorityRole) =>
        live ? api.suspendStaff(staffId, authorityRole).then(after) : sim().suspendStaff(staffId),
      registerStaff: (role, staffId) =>
        live ? api.registerStaff(role, staffId).then(after) : sim().registerStaff(role, staffId),
      startElection: (candidateRoles, authorityRole) =>
        live ? api.startElection(candidateRoles, authorityRole).then(after) : sim().startElection(candidateRoles),
      castVote: (voterRole, candidateRole) =>
        live ? api.castVote(voterRole, candidateRole).then(after) : sim().castVote(voterRole, candidateRole),
      closeElection: (authorityRole) =>
        live ? api.closeElection(authorityRole).then(after) : sim().closeElection(),
      playStory: () => (live ? Promise.resolve() : sim().playStory()),
    };
  }, [mode, config]);

  const value = {
    mode,
    config,
    units,
    events,
    oversight,
    actions,
    storyState,
    refresh,
    isSim: mode === "sim",
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}
