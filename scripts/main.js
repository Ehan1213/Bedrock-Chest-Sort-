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
} from "@minecraft/server";

const INV_ID = BlockComponentTypes.Inventory; // "minecraft:inventory"
const VERBOSE = false; // flip to false once you trust it
const DEBUG_KEYS = false; // logs merge-key diagnostics and skips writes
const CREATOR_TOOLS_LOGGING = false; // writes logs to console for Creator Tools
const log = (p, msg, c = "7") => {
  if (VERBOSE) p.sendMessage(`§${c}${msg}`);
  creatorToolsLog("info", msg);
};
const debugKeyLog = (p, msg, c = "8") => {
  if (DEBUG_KEYS) p.sendMessage(`§${c}${msg}`);
  if (DEBUG_KEYS) creatorToolsLog("debug", msg);
};

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
    const oldKey = getLegacyItemKey(stk);
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
    if (!merged.has(key)) {
      merged.set(key, {
        proto: stk.clone(),
        qty: 0,
        max: stk.maxAmount,
        members: DEBUG_KEYS ? [] : undefined,
      });
    }
    const entry = merged.get(key);
    entry.qty += stk.amount;
    if (DEBUG_KEYS) {
      const details = getItemIdentityDetails(stk);
      entry.members.push({
        slot,
        amount: stk.amount,
        oldKey,
        newKey: key,
        details,
      });
      debugKeyLog(
        player,
        `[key] slot=${slot} ${oldKey} -> ${key} mergedQty=${entry.qty}`
      );
      if (details.bookProbe) {
        debugKeyLog(
          player,
          `[book] slot=${slot} probe=${stableStringify(details.bookProbe)}`
        );
      }
      if (entry.members.length > 1) {
        const previous = entry.members[0];
        debugKeyLog(
          player,
          `[equal] slot=${slot} matched slot=${previous.slot} because ${explainKeyEquality(previous.details, details)}`
        );
      }
    }
  }

  if (DEBUG_KEYS) {
    debugKeyLog(player, `[dry-run] computed ${merged.size} merged groups; no container changes written`, "6");
    return;
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

  if (hasSameLayout(before, final)) {
    log(player, "§7Container already sorted");
    return;
  }

  // Write new order
  writeSnapshot(cont, final);

  // Verify counts (ignore slot order)
  const after = snapshot(cont);
  const diffMsg = compareCounts(before, after);

  if (diffMsg) {
    log(player, `§c❌ Sorting failed – ${diffMsg}`);
    // Roll back
    writeSnapshot(cont, before);
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

function writeSnapshot(container, items) {
  container.clearAll();
  items.forEach((stk, i) => stk && container.setItem(i, stk));
}

function hasSameLayout(before, after) {
  if (before.length !== after.length) return false;

  for (let i = 0; i < before.length; i++) {
    if (!isSameStack(before[i], after[i])) return false;
  }

  return true;
}

function isSameStack(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;

  return left.amount === right.amount && getItemKey(left) === getItemKey(right);
}

function getItemKey(stk) {
  const parts = [`${stk.typeId}:${stk.data ?? 0}`];
  const nameTag = typeof stk.nameTag === "string" ? stk.nameTag : "";
  const lore = safeGetLore(stk);
  const enchantments = getEnchantmentsSignature(stk);
  const book = getBookSignature(stk);
  const componentState = getInterestingComponentState(stk);

  if (nameTag) parts.push(`name=${stableStringify(nameTag)}`);
  if (lore.length) parts.push(`lore=${stableStringify(lore)}`);
  if (enchantments) parts.push(`ench=${enchantments}`);
  if (book) parts.push(`book=${book}`);
  if (componentState) parts.push(`cmp=${componentState}`);

  return parts.join("|");
}

function getLegacyItemKey(stk) {
  return `${stk.typeId}:${stk.data ?? 0}`;
}

function getItemIdentityDetails(stk) {
  const bookProbe = getBookDebugProbe(stk);

  return {
    typeId: stk.typeId,
    data: stk.data ?? 0,
    nameTag: typeof stk.nameTag === "string" ? stk.nameTag : "",
    lore: safeGetLore(stk),
    enchantments: getEnchantmentsSignature(stk),
    book: getBookSignature(stk),
    bookProbe,
    componentState: getInterestingComponentState(stk),
    componentIds: getComponentIds(stk),
  };
}

function explainKeyEquality(left, right) {
  const reasons = [];

  if (left.typeId === right.typeId) reasons.push(`typeId=${left.typeId}`);
  if (left.data === right.data) reasons.push(`data=${left.data}`);
  if (left.nameTag === right.nameTag && left.nameTag)
    reasons.push(`name=${stableStringify(left.nameTag)}`);
  if (stableStringify(left.lore) === stableStringify(right.lore) && left.lore.length)
    reasons.push(`lore=${stableStringify(left.lore)}`);
  if (left.enchantments === right.enchantments && left.enchantments)
    reasons.push(`ench=${left.enchantments}`);
  if (left.book === right.book && left.book)
    reasons.push(`book=${left.book}`);
  if (left.componentState === right.componentState && left.componentState)
    reasons.push(`cmp=${left.componentState}`);

  const leftExtra = left.componentIds.filter((id) => right.componentIds.includes(id));
  if (leftExtra.length) reasons.push(`sharedComponents=${leftExtra.join("/")}`);

  return reasons.length > 0 ? reasons.join("; ") : "their computed metadata signature was identical";
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

function getBookSignature(stk) {
  const component = getFirstComponent(stk, ["minecraft:book"]);
  if (!component) return "";

  try {
    const pageCount = readComponentValue(component, ["pageCount", "getPageCount"]);
    const signature = {
      title: readComponentValue(component, ["title", "getTitle"]),
      author: readComponentValue(component, ["author", "getAuthor"]),
      pages: getBookPages(component, pageCount),
      pageCount,
      generation: readComponentValue(component, ["generation", "getGeneration"]),
      resolved: readComponentValue(component, ["resolved", "isResolved"]),
    };

    const normalized = normalizeValue(signature);
    return normalized ? JSON.stringify(normalized) : "";
  } catch {
    return "";
  }
}

function getBookDebugProbe(stk) {
  if (!DEBUG_KEYS) return undefined;

  const component = getFirstComponent(stk, ["minecraft:book"]);
  if (!component) return undefined;

  const proto = Object.getPrototypeOf(component);
  const protoMethods = proto ? Object.getOwnPropertyNames(proto).sort() : [];
  const sampled = {};

  for (const name of protoMethods) {
    if (
      name === "constructor" ||
      !/(author|title|page|text|content|message|book)/i.test(name)
    ) {
      continue;
    }

    const result = readComponentValue(component, [name]);
    if (result !== undefined) sampled[name] = result;
  }

  const ownKeys = {};
  for (const key of Object.keys(component).sort()) {
    if (typeof component[key] === "function") continue;
    const result = normalizeValue(component[key]);
    if (result !== undefined) ownKeys[key] = result;
  }

  const probe = normalizeValue({
    ownKeys,
    protoMethods,
    sampled,
  });

  return probe && (Object.keys(probe.ownKeys ?? {}).length > 0 || Object.keys(probe.sampled ?? {}).length > 0)
    ? probe
    : undefined;
}

function getInterestingComponentState(stk) {
  const states = [];

  for (const component of stk.getComponents?.() ?? []) {
    if (
      component.typeId === "minecraft:enchantable" ||
      component.typeId === "minecraft:enchantments" ||
      component.typeId === "minecraft:book"
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

function readComponentValue(component, names) {
  for (const name of names) {
    try {
      const value = component[name];
      if (typeof value === "function") {
        const result = value.call(component);
        if (result !== undefined) return normalizeValue(result);
        continue;
      }
      if (value !== undefined) return normalizeValue(value);
    } catch {
      // Keep probing alternate members.
    }
  }
  return undefined;
}

function getBookPages(component, pageCount) {
  const direct = readComponentValue(component, [
    "pages",
    "getPages",
    "text",
    "getText",
    "content",
    "getContent",
    "contents",
    "getContents",
    "messages",
    "getMessages",
  ]);
  if (direct !== undefined) return direct;

  const indexed = getIndexedBookPages(component, pageCount, [
    "getPage",
    "getPageContent",
    "getRawPageContent",
  ], 0);
  if (indexed !== undefined) return indexed;

  return getIndexedBookPages(component, pageCount, [
    "getPage",
    "getPageContent",
    "getRawPageContent",
  ], 1);
}

function getIndexedBookPages(component, pageCount, methodNames, startIndex) {
  if (!Number.isInteger(pageCount) || pageCount <= 0) return undefined;

  const getPageMethod = methodNames.find(
    (methodName) => typeof component[methodName] === "function"
  );
  if (!getPageMethod) return undefined;

  const pages = [];
  for (let offset = 0; offset < pageCount; offset++) {
    try {
      pages.push(
        normalizeValue(component[getPageMethod](startIndex + offset))
      );
    } catch {
      return undefined;
    }
  }

  return pages.some((page) => page !== undefined) ? pages : undefined;
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

function creatorToolsLog(level, msg) {
  if (!CREATOR_TOOLS_LOGGING) return;

  const line = `[ChestSorter:${level}] ${stripFormatting(msg)}`;
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "debug") {
    console.warn(line);
    return;
  }
  console.log(line);
}

function stripFormatting(msg) {
  return String(msg).replace(/§[0-9A-FK-OR]/gi, "");
}
