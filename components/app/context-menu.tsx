"use client";

import { useEffect, useRef } from "react";
import { create } from "zustand";

/* Menu do botão direito para servidores e canais (o das pessoas fica em user-menu.tsx). */

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** linha separadora antes deste item */
  sep?: boolean;
}
interface State {
  menu: { x: number; y: number; title?: string; items: MenuItem[] } | null;
}
const useMenu = create<State>(() => ({ menu: null }));

export function openContextMenu(e: React.MouseEvent, items: MenuItem[], title?: string) {
  e.preventDefault();
  e.stopPropagation();
  useMenu.setState({ menu: { x: e.clientX, y: e.clientY, items, title } });
}
const close = () => useMenu.setState({ menu: null });

export function ContextMenuHost() {
  const menu = useMenu((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const el = ref.current;
    el?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
    const down = (e: MouseEvent) => {
      if (!el?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const items = [...(el?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  if (!menu) return null;
  const w = 220;
  const h = menu.items.length * 36 + (menu.title ? 32 : 0) + 12;
  const left = Math.min(menu.x, window.innerWidth - w - 8);
  const top = Math.min(menu.y, window.innerHeight - h - 8);
  return (
    <div ref={ref} role="menu" aria-label={menu.title ?? "Opções"} style={{ left, top, width: w }} className="pop-in fixed z-[70] rounded-[12px] bg-cocoa-0 p-1.5 shadow-[0_12px_40px_rgb(0_0_0/0.5)]">
      {menu.title && <p className="label truncate px-2.5 pb-1 pt-1.5 text-oat/45">{menu.title}</p>}
      {menu.items.map((it) => (
        <div key={it.label}>
          {it.sep && <div className="mx-2 my-1 h-px bg-oat/10" />}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              it.onClick();
            }}
            className={`block w-full rounded-[8px] px-2.5 py-2 text-left text-[13.5px] outline-none focus-visible:bg-ember focus-visible:text-white hover:bg-ember hover:text-white ${it.danger ? "text-[#ff8f92]" : ""}`}
          >
            {it.label}
          </button>
        </div>
      ))}
    </div>
  );
}
