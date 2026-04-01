// main.js – Robust Chest‑Sorting Script for BDS / Single‑player 1.21.90+
// -----------------------------------------------------------------------------
// Sneak‑click any inventory block (chest, barrel, etc.) while crouching to
// stack + alphabetise its contents. No cheats are required.
//
// Key improvements in this version
// • Uses next‑tick scheduling (system.run) so writes persist.
// • Stacks up to each item’s own maxAmount (64 for most items, 1 for tools, etc.).
// • Verifies integrity **by total item counts only** (slot order obviously changes!),
//   preventing false roll‑backs.
// • If counts differ, rolls back and prints a *precise* diff of missing/extra items.
// • Single VERBOSE flag to toggle chat spam.
// -----------------------------------------------------------------------------

import {
  world,
  system,
  BlockComponentTypes,
  ItemStack,
} from "@minecraft/server";

const INV_ID = BlockComponentTypes.Inventory; // "minecraft:inventory"
const VERBOSE = true; // flip to false once you trust it
const log = (p, msg, c = "7") => VERBOSE && p.sendMessage(`§${c}${msg}`);

// ───────── Event hook ────────────────────────────────────────────────────────
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  if (!ev.player.isSneaking) return; // trigger only when crouching
  // ev.cancel = true; // stop vanilla GUI from opening
  system.run(() => sortContainer(ev.player, ev.block)); // run next tick
});

// ───────── Main sorter ────────────────────────────────────────────────────────
function sortContainer(player, clickedBlock) {
  const chest = player.dimension.getBlock(clickedBlock.location);
  const inv = chest.getComponent(INV_ID);
  if (!inv) {
    log(player, "§cNo inventory component!");
    return;
  }
  const cont = inv.container;
  if (!cont?.isValid) {
    log(player, "§cContainer invalid / chunk not loaded");
    return;
  }

  const size = cont.size;
  const before = snapshot(cont);

  // Build merged stacks keyed by item identity + metadata.
  const merged = new Map();
  for (let slot = 0; slot < before.length; slot++) {
    const stk = before[slot];
    if (!stk) continue;
    const key = getItemKey(stk);
    if (VERBOSE) {
      const componentIds = getComponentIds(stk).join(", ") || "none";
      log(
        player,
        `[merge] slot=${slot} item=${stk.typeId} amount=${stk.amount} key=${key}`,
        "8"
      );
      log(player, `[merge] slot=${slot} components=${componentIds}`, "8");
    }
    if (!merged.has(key))
      merged.set(key, { proto: stk.clone(), qty: 0, max: stk.maxAmount });
    merged.get(key).qty += stk.amount;
  }

  // Produce alphabetically sorted array of stacks, split by max stack size
  const final = [];
  [...merged.keys()].sort().forEach((k) => {
    const { proto, qty, max } = merged.get(k);
    let left = qty;
    while (left > 0 && final.length < size) {
      const s = proto.clone();
      s.amount = Math.min(left, max);
      final.push(s);
      left -= s.amount;
    }
  });
  while (final.length < size) final.push(null);

  // Write new order
  cont.clearAll();
  final.forEach((stk, i) => stk && cont.setItem(i, stk));

  // Verify counts (ignore slot order)
  const after = snapshot(cont);
  const diffMsg = compareCounts(before, after);

  if (diffMsg) {
    log(player, `§c❌ Sorting failed – ${diffMsg}`);
    // Roll back
    cont.clearAll();
    before.forEach((stk, i) => stk && cont.setItem(i, stk));
  } else {
    log(player, "§aChest sorted!");
  }
}

// ───────── Helpers ───────────────────────────────────────────────────────────
function snapshot(container) {
  return Array.from({ length: container.size }, (_, i) =>
    container.getItem(i)?.clone() || null
  );
}

function getItemKey(stk) {
  const parts = [`${stk.typeId}:${stk.data ?? 0}`];
  const nameTag = typeof stk.nameTag === "string" ? stk.nameTag : "";
  const lore = safeGetLore(stk);
  const enchantments = getEnchantmentsSignature(stk);
  const componentState = getInterestingComponentState(stk);

  if (nameTag) parts.push(`name=${stableStringify(nameTag)}`);
  if (lore.length) parts.push(`lore=${stableStringify(lore)}`);
  if (enchantments) parts.push(`ench=${enchantments}`);
  if (componentState) parts.push(`cmp=${componentState}`);

  return parts.join("|");
}

function safeGetLore(stk) {
  try {
    return typeof stk.getLore === "function" ? stk.getLore() ?? [] : [];
  } catch {
    return [];
  }
}

function getComponentIds(stk) {
  try {
    return (stk.getComponents?.() ?? []).map((component) => component.typeId);
  } catch {
    return [];
  }
}

function getEnchantmentsSignature(stk) {
  const component = getFirstComponent(stk, [
    "minecraft:enchantable",
    "minecraft:enchantments",
  ]);

  if (!component || typeof component.getEnchantments !== "function") {
    return "";
  }

  try {
    const raw = component.getEnchantments();
    const list =
      Array.isArray(raw)
        ? raw
        : typeof raw?.getEnchantments === "function"
          ? raw.getEnchantments()
          : Array.isArray(raw?.enchantments)
            ? raw.enchantments
            : [];

    if (!Array.isArray(list) || list.length === 0) {
      return "";
    }

    return stableStringify(
      list
        .map((entry) => ({
          type:
            entry?.type?.id ??
            entry?.type?.typeId ??
            entry?.typeId ??
            String(entry?.type ?? "unknown"),
          level: entry?.level ?? 0,
        }))
        .sort((a, b) => `${a.type}:${a.level}`.localeCompare(`${b.type}:${b.level}`))
    );
  } catch {
    return "";
  }
}

function getInterestingComponentState(stk) {
  const states = [];

  for (const component of stk.getComponents?.() ?? []) {
    if (
      component.typeId === "minecraft:enchantable" ||
      component.typeId === "minecraft:enchantments"
    ) {
      continue;
    }

    const state = {};
    for (const key of Object.keys(component)) {
      if (key === "typeId" || typeof component[key] === "function") continue;
      const normalized = normalizeValue(component[key]);
      if (normalized !== undefined) state[key] = normalized;
    }

    if (Object.keys(state).length > 0) {
      states.push({ typeId: component.typeId, state });
    }
  }

  return states.length ? stableStringify(states) : "";
}

function getFirstComponent(stk, componentIds) {
  for (const componentId of componentIds) {
    try {
      const component = stk.getComponent?.(componentId);
      if (component) return component;
    } catch {
      // Some versions expose different component ids; fall through.
    }
  }
  return null;
}

function normalizeValue(value) {
  if (value == null) return value;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeValue(entry))
      .filter((entry) => entry !== undefined);
  }
  if (typeof value === "object") {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (typeof value[key] === "function") continue;
      const nested = normalizeValue(value[key]);
      if (nested !== undefined) normalized[key] = nested;
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }
  return undefined;
}

function stableStringify(value) {
  return JSON.stringify(normalizeValue(value));
}

// Returns null if counts identical, otherwise a human diff string
function compareCounts(before, after) {
  const tally = new Map(); // metadata-aware item key -> net count
  const add = (m, stk, delta) => {
    const k = getItemKey(stk);
    m.set(k, (m.get(k) || 0) + delta * stk.amount);
  };
  for (const s of before) if (s) add(tally, s, 1);
  for (const s of after) if (s) add(tally, s, -1);

  const problems = [...tally.entries()].filter(([, v]) => v !== 0);
  if (problems.length === 0) return null;
  return problems
    .map(([k, v]) => `${k} net ${v > 0 ? "+" : ""}${v}`)
    .join(", ");
}
