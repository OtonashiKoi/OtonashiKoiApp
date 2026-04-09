const { readStore, updateStore } = require("./jsonStore");

class JsonMonsterRepository {
  async findAll() {
    const store = await readStore();
    const monsters = Array.isArray(store.monsters) ? store.monsters : [];
    return [...monsters].sort((a, b) => a.seq - b.seq);
  }

  async findById(id) {
    const monsters = await this.findAll();
    return monsters.find((m) => m.id === id) || null;
  }

  async save(monster) {
    await updateStore((store) => {
      if (!Array.isArray(store.monsters)) store.monsters = [];
      const idx = store.monsters.findIndex((m) => m.id === monster.id);
      if (idx >= 0) store.monsters[idx] = monster;
      else store.monsters.push(monster);
      return store;
    });
    return monster;
  }

  async delete(id) {
    await updateStore((store) => {
      store.monsters = (store.monsters || []).filter((m) => m.id !== id);
      return store;
    });
  }

  async getState(zoneKey = "normal") {
    const store = await readStore();
    const key = zoneKey === "mid" ? "monsterStateMid" : "monsterState";
    return store[key] || { activeMonsterSeq: 1, currentHp: null, killCount: {}, participants: [] };
  }

  async saveState(state, zoneKey = "normal") {
    const key = zoneKey === "mid" ? "monsterStateMid" : "monsterState";
    await updateStore((store) => {
      store[key] = state;
      return store;
    });
    return state;
  }

  // JSON 不會有多進程問題，永遠回傳 true
  async claimKill(_zoneKey, _monsterSeq) {
    return true;
  }
}

module.exports = { JsonMonsterRepository };
