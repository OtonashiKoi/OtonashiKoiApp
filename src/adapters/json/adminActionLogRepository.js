const { AdminActionLogRepository } = require("../../repositories/interfaces/adminActionLogRepository");
const { readStore, writeStore } = require("./jsonStore");

class JsonAdminActionLogRepository extends AdminActionLogRepository {
  async append(entry) {
    const data = await readStore();
    data.adminActionLogs.push(entry);
    await writeStore(data);
    return entry;
  }

  async listRecent(limit = 20) {
    const data = await readStore();
    return data.adminActionLogs.slice(-limit).reverse();
  }
}

module.exports = {
  JsonAdminActionLogRepository
};