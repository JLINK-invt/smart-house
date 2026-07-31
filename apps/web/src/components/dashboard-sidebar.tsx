"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const navigation = [
  { href: "/dashboard", label: "Resumen", code: "OV" },
  { href: "/dashboard/inventory", label: "Dispositivos", code: "DV" },
  { href: "/dashboard/telemetry", label: "Telemetria", code: "TM" },
  { href: "/dashboard/commands", label: "Comandos", code: "CM" },
  { href: "/dashboard/alerts", label: "Alertas", code: "AL" },
  { href: "/dashboard/settings", label: "Organizacion", code: "OR" },
];

export function DashboardSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <button
        className="menu-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="dashboard-navigation"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true" className="menu-toggle-lines" />
        Menu
      </button>
      <aside className={`dashboard-sidebar ${open ? "is-open" : ""}`} id="dashboard-navigation">
        <Link className="aero-brand" href="/dashboard" onClick={() => setOpen(false)}>
          <span className="aero-orb">SH</span>
          <span>
            <strong>Smart House</strong>
            <small>Control Center</small>
          </span>
        </Link>
        <nav aria-label="Navegacion principal">
          {navigation.map((item) => {
            const active = pathname === item.href;

            return (
              <Link
                className={`side-link ${active ? "is-active" : ""}`}
                href={item.href}
                key={item.href}
                onClick={() => setOpen(false)}
              >
                <span className="side-code">{item.code}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="live-dot" />
          Entorno local
        </div>
      </aside>
    </>
  );
}
