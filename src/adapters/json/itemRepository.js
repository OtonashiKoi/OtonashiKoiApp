const { readStore, writeStore } = require("./jsonStore");

class JsonItemRepository {
  async findAll() {
    const store = await readStore();
    return Array.isArray(store.items) ? store.items : [];
  }

  async findById(id) {
    const items = await this.findAll();
    return items.find((item) => item.id === id) || null;
  }

  async save(item) {
    const store = await readStore();
    if (!Array.isArray(store.items)) store.items = [];
    const idx = store.items.findIndex((i) => i.id === item.id);
    if (idx >= 0) {
      store.items[idx] = item;
    } else {
      store.items.push(item);
    }
    await writeStore(store);
    return item;
  }

  async delete(id) {
    const store = await readStore();
    if (!Array.isArray(store.items)) store.items = [];
    store.items = store.items.filter((i) => i.id !== id);
    await writeStore(store);
  }
}

module.exports = { JsonItemRepository };
