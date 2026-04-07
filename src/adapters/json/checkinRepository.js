const { CheckinRepository } = require("../../repositories/interfaces/checkinRepository");
const { readStore, writeStore } = require("./jsonStore");

class JsonCheckinRepository extends CheckinRepository {
  async save(checkin) {
    const data = await readStore();
    data.checkins = data.checkins || [];
    data.checkins.push(checkin);
    await writeStore(data);
    return checkin;
  }

  async findLastByDiscordId(discordId) {
    const data = await readStore();
    const items = (data.checkins || []).filter((c) => c.discordId === discordId);
    if (!items.length) return null;
    items.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
    return items[0];
  }

  async listByDiscordId(discordId) {
    const data = await readStore();
    return (data.checkins || []).filter((c) => c.discordId === discordId);
  }

  async countAllByPlayer() {
    const data = await readStore();
    const counts = {};
    for (const c of (data.checkins || [])) {
      counts[c.discordId] = (counts[c.discordId] || 0) + 1;
    }
    return counts; // { discordId: count }
  }
}

module.exports = {
  JsonCheckinRepository
};
