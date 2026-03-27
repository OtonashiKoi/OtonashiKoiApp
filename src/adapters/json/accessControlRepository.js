const { AccessControlRepository } = require("../../repositories/interfaces/accessControlRepository");
const { readStore, writeStore } = require("./jsonStore");

const DEFAULT_ACCESS_CONTROL = {
  discord: {
    adminRoleIds: [],
    adminUserIds: [],
    playerRoleIds: [],
    playerUserIds: []
  }
};

class JsonAccessControlRepository extends AccessControlRepository {
  async get() {
    const data = await readStore();
    return data.accessControl || { ...DEFAULT_ACCESS_CONTROL };
  }

  async save(accessControl) {
    const data = await readStore();
    data.accessControl = accessControl;
    await writeStore(data);
    return accessControl;
  }
}

module.exports = {
  DEFAULT_ACCESS_CONTROL,
  JsonAccessControlRepository
};