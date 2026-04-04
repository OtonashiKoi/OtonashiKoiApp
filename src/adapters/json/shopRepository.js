const { readStore, writeStore } = require("./jsonStore");

class JsonShopRepository {
  async findAll() {
    const store = await readStore();
    return Array.isArray(store.shopItems) ? store.shopItems : [];
  }

  async findById(id) {
    const items = await this.findAll();
    return items.find((item) => item.id === id) || null;
  }

  async save(item) {
    const store = await readStore();
    if (!Array.isArray(store.shopItems)) store.shopItems = [];
    const idx = store.shopItems.findIndex((i) => i.id === item.id);
    if (idx >= 0) {
      store.shopItems[idx] = item;
    } else {
      store.shopItems.push(item);
    }
    await writeStore(store);
    return item;
  }

  async delete(id) {
    const store = await readStore();
    if (!Array.isArray(store.shopItems)) store.shopItems = [];
    store.shopItems = store.shopItems.filter((i) => i.id !== id);
    await writeStore(store);
  }
}

module.exports = { JsonShopRepository };
