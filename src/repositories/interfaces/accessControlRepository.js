class AccessControlRepository {
  async get() {
    throw new Error("get must be implemented");
  }

  async save() {
    throw new Error("save must be implemented");
  }
}

module.exports = {
  AccessControlRepository
};