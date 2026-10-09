"use strict";
const { isStackMergeable } = require("../../shared/inventoryStacking");

function isMergeableEntry(entry) {
  return Boolean(entry && !entry.locked && isStackMergeable(entry.itemId));
}

function stackCountsByItemId(inventory) {
  const totals = new Map();
  for (const entry of Array.isArray(inventory) ? inventory : []) {
    if (!isMergeableEntry(entry)) continue;
    const id = String(entry.itemId);
    totals.set(id, (totals.get(id) || 0) + Math.max(1, Math.trunc(Number(entry.stackCount) || 1)));
  }
  return Object.fromEntries(totals);
}

// Quantities belong to an item pool, not to the UUID chosen during normalization.
// Apply the caller's quantity delta to the latest DB total. Consolidating old
// stacks in another save must neither look like a reward nor undo a debit.
function reconcileStackableInventory(outInventory, dbInventory, baseline) {
  const base = baseline?.stackCountsByItemId || {};
  const managedItemIds = new Set(Object.keys(base));
  const outCounts = stackCountsByItemId(outInventory);
  const dbCounts = stackCountsByItemId(dbInventory);
  const nextCounts = new Map();
  for (const id of managedItemIds) {
    const next = (outCounts[id] || 0) + (dbCounts[id] || 0) - base[id];
    if (next < 0) {
      const error = new Error(`INVENTORY_STACK_CONFLICT:${id}`);
      error.code = "INVENTORY_STACK_CONFLICT";
      throw error;
    }
    nextCounts.set(id, next);
  }
  const seen = new Set();
  const inventory = [];
  for (const entry of outInventory) {
    const id = String(entry?.itemId || "");
    if (!isMergeableEntry(entry) || !managedItemIds.has(id)) {
      inventory.push(entry);
    } else if (!seen.has(id)) {
      seen.add(id);
      const count = nextCounts.get(id);
      if (count > 0) inventory.push({ ...entry, stackCount: count });
    }
  }
  for (const id of managedItemIds) {
    // The caller spent the whole old pool, but a concurrent drop may remain.
    if (seen.has(id) || nextCounts.get(id) <= 0) continue;
    const template = dbInventory.find(entry => isMergeableEntry(entry) && String(entry.itemId) === id);
    inventory.push({ ...template, stackCount: nextCounts.get(id) });
  }
  return { inventory, managedItemIds };
}

// Record the save ID in the same atomic update as the inventory. A driver error
// after commit may be retried; it must not apply the quantity delta a second time.
function inventorySaveReceipt(id) {
  return { $push: { inventorySaveReceipts: { $each: [id], $slice: -128 } } };
}

module.exports = { isMergeableEntry, stackCountsByItemId, reconcileStackableInventory, inventorySaveReceipt };
