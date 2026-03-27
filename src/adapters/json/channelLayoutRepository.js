const { readStore, writeStore } = require("./jsonStore");

class JsonChannelLayoutRepository {
  async get() {
    const store = await readStore();
    return store.channelLayout || { discord: { bindings: [] } };
  }

  async save(channelLayout) {
    const store = await readStore();
    store.channelLayout = channelLayout;
    await writeStore(store);
    return channelLayout;
  }
}

module.exports = {
  JsonChannelLayoutRepository
};