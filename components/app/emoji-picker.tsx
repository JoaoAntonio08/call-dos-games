"use client";

import { useState } from "react";
import type { CustomEmoji } from "@/lib/types";

const GROUPS: { name: string; list: string }[] = [
  { name: "Rostos", list: "😀 😂 🤣 😊 😍 🥰 😘 😎 🤩 🥳 😏 😅 😬 🙃 😴 🤔 🫠 🥲 😭 😤 😡 🤯 😱 🥶 🤡 💀 👻 🤖 👀 🫡 🤝 👍 👎 👏 🙌 🙏 💪 🫶 ✌️ 🤌" },
  { name: "Coisas", list: "🔥 ✨ 💯 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 ⭐ 🌙 ☕ 🍿 🍕 🍜 🍣 🍙 🍩 🍺 🧃 🎮 🕹️ 🎧 🎤 🎬 📺 🏆 🎲 🗡️ 🛡️ 🏹 🧙 🐉 🍄 💎 💰 📌 🎉" },
  { name: "Bichos", list: "🐱 🐶 🦊 🐻 🐼 🐨 🐸 🐵 🐧 🦆 🦉 🐺 🦝 🐢 🐍 🦖 🐙 🦀 🐟 🐬 🦋 🐝 🌸 🌻 🍁 🌵 🌊 ⛰️ 🌈 ☁️" },
];

export function EmojiPicker({ emojis = [], onPick }: { emojis?: CustomEmoji[]; onPick: (e: string) => void }) {
  const [q, setQ] = useState("");
  const custom = q ? emojis.filter((e) => e.name.includes(q.toLowerCase())) : emojis;
  return (
    <div className="w-[320px] rounded-[16px] bg-cocoa-0 p-3">
      {emojis.length > 0 && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar emoji do servidor" className="field mb-2 h-9 !py-0 text-[13px]" autoFocus />
      )}
      <div className="max-h-[300px] overflow-y-auto pr-1">
        {custom.length > 0 && (
          <>
            <p className="label mb-1.5 mt-1 text-oat/40">Do servidor</p>
            <div className="grid grid-cols-8 gap-0.5">
              {custom.map((e) => (
                <button key={e.id} type="button" title={`:${e.name}:`} onClick={() => onPick(`:${e.name}:`)} className="press grid aspect-square place-items-center rounded-[8px] hover:bg-cocoa-4">
                  <img src={e.url} alt={e.name} className="size-7 object-contain" />
                </button>
              ))}
            </div>
          </>
        )}
        {!q &&
          GROUPS.map((g) => (
            <div key={g.name}>
              <p className="label mb-1.5 mt-3 text-oat/40 first:mt-1">{g.name}</p>
              <div className="grid grid-cols-8 gap-0.5">
                {g.list.split(" ").map((e) => (
                  <button key={e} type="button" onClick={() => onPick(e)} className="press grid aspect-square place-items-center rounded-[8px] text-[22px] hover:bg-cocoa-4">
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

export const QUICK_REACTIONS = ["👍", "😂", "❤️", "🔥", "💀", "👀"];
