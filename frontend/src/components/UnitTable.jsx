// Dense ledger-style unit table shared by the role dashboards. Serials are
// links to the public trace view; every row's status is icon + label, and
// the actions column is injected per-role.

import React from "react";
import { Link } from "react-router-dom";
import { useStore } from "../lib/store.jsx";
import { StatusBadge, Empty } from "./ui.jsx";
import { isoShort, timeAgo } from "../lib/format.js";

export default function UnitTable({ units, actions, emptyLabel = "no units" }) {
  const { config } = useStore();
  const accounts = config?.accounts ?? {};
  const holderName = (holder) => {
    if (!holder || holder === "blood_bank" || holder === accounts.BANK) return "Blood Bank";
    const entry = Object.entries(accounts).find(([, id]) => id === holder);
    return entry ? entry[0].charAt(0) + entry[0].slice(1).toLowerCase() : holder;
  };

  if (units.length === 0) return <Empty>{emptyLabel}</Empty>;

  return (
    <div className="overflow-x-auto thin-scroll">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-hairline">
            <Th>Unit</Th>
            <Th>Batch</Th>
            <Th>Status</Th>
            <Th>Holder</Th>
            <Th>Staff</Th>
            <Th>Age</Th>
            {actions && <Th>Actions</Th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-grid">
          {units.map((u) => (
            <tr key={u.serial} className="hover:bg-surface-2/40 transition-colors">
              <td className="py-2 pr-3">
                <Link to={`/trace/${u.serial}`} className="ledger text-[13px] text-ink hover:text-ledger">
                  #{u.serial}
                </Link>
              </td>
              <td className="py-2 pr-3 ledger text-xs text-ink-2">{u.donorBatchId ?? "—"}</td>
              <td className="py-2 pr-3">
                <StatusBadge status={u.status} />
              </td>
              <td className="py-2 pr-3 text-xs text-ink-2">{holderName(u.holder)}</td>
              <td className="py-2 pr-3 ledger text-xs text-ink-3">{u.staffId ?? "—"}</td>
              <td className="py-2 pr-3 text-xs text-ink-3" title={isoShort(u.mintedAt)}>
                {timeAgo(u.mintedAt)}
              </td>
              {actions && <td className="py-2">{actions(u)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }) {
  return <th className="overline pb-2 pr-3 font-semibold">{children}</th>;
}
