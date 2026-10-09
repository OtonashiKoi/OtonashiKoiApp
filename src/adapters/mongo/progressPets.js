'use strict';
const { AppError } = require('../../shared/errors');
const signature = pets => JSON.stringify((pets || []).map(({ locked, ...pet }) => pet));

function reconcilePets(incoming, current, baseline) {
  const now = Array.isArray(current) ? current : [];
  // Serialized general saves cannot express pet deletions. Dedicated CAS writes
  // provide a fresh baseline instead; ordinary reward snapshots preserve pets.
  if (!baseline) return now;
  if (signature(now) !== signature(baseline)) {
    if (signature(incoming) === signature(baseline)) return now;
    throw new AppError('PET_WRITE_CONFLICT', '寵物資料已更新，請重新整理後再操作', 409);
  }
  const next = Array.isArray(incoming) ? incoming : [];
  for (const pet of now) {
    if (pet.locked && !next.some(p => p.uuid === pet.uuid)) {
      throw new AppError('PET_LOCKED', '寵物已鎖定，請先解鎖', 409);
    }
  }
  const locks = new Map(now.map(p => [p.uuid, Boolean(p.locked)]));
  return next.map(p => locks.has(p.uuid) ? { ...p, locked: locks.get(p.uuid) } : p);
}
module.exports = { reconcilePets };
