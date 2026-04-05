const { readStore, writeStore } = require("./jsonStore");

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
    const store = await readStore();
    if (!Array.isArray(store.monsters)) store.monsters = [];
    const idx = store.monsters.findIndex((m) => m.id === monster.id);
    if (idx >= 0) {
      store.monsters[idx] = monster;
    } else {
      store.monsters.push(monster);
    }
    await writeStore(store);
    return monster;
  }

  async delete(id) {
    const store = await readStore();
    if (!Array.isArray(store.monsters)) store.monsters = [];
    store.monsters = store.monsters.filter((m) => m.id !== id);
    await writeStore(store);
  }

  async getState() {
    const store = await readStore();
    return store.monsterState || { activeMonsterSeq: 1, currentHp: null, killCount: {} };
  }

  async saveState(state) {
    const store = await readStore();
    store.monsterState = state;
    await writeStore(store);
    return state;
  }
}

module.exports = { JsonMonsterRepository };
