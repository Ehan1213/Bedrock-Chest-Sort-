# Chest Sorter (Minecraft Bedrock Edition)

A powerful inventory-sorting behavior pack for Minecraft Bedrock 1.21.90+.  
Sneak + click any container (chest, barrel, etc.) to instantly alphabetize and stack its contents — no cheats required!

![Chest Sorter Icon](./pack_icon.png)

---

## 📦 Features

- ✅ Works in **singleplayer**, **multiplayer**, and **dedicated server (BDS)**
- ✅ **Stacks up to each item’s actual max stack size**
- ✅ **Alphabetical sorting** by metadata-aware item key
- ✅ **Safe rollback** if any item gets lost
- ✅ Preserves **written books**, **enchanted items**, custom names, lore, and other readable item metadata
- ✅ Optional **dry-run diagnostics** for Creator Tools / chat debugging
- ✅ Fully written in JavaScript using `@minecraft/server` v2.0.0
- ✅ Supports all vanilla containers with inventories

---

## 🛠️ How It Works

- Sneak + interact with a container
- The mod:
  - Clones and tallies all items
  - Builds a metadata-aware key for each item
  - Merges only items with identical keys
  - Sorts alphabetically
  - Writes the result back the next tick
  - Skips rewriting containers that are already sorted
  - Verifies **total item count matches** original
  - If mismatch, reverts and logs the issue in chat or Creator Tools

---

## 🔧 Installation

1. Enable **Script API** and **Beta APIs** (optional) in your world settings.
2. Drop this behavior pack into your `behavior_packs` folder.
3. In the world folder, add the behavior pack to `world_behavior_packs.json`.
4. Load the world and enjoy streamlined storage.

> Cheats are **not required** — all features work in survival without command use.

---

## 📁 File Structure

📦 chest-sorter/
├── manifest.json
├── pack_icon.png
└── scripts/
└── main.js


---

## 🧪 Tested On

- Minecraft Bedrock 1.21.90+
- Windows 10/11, Dedicated Server (BDS)
- Singleplayer + local multiplayer

---

## 📜 License

MIT License — use, modify, and share freely. Attribution appreciated!

---

## 💡 Idea by

@p99will — Minecraft tooling for builders, modders, and pack-makers.
