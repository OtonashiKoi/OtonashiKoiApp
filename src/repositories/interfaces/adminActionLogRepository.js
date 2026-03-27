class AdminActionLogRepository {
  async append() {
    throw new Error("append must be implemented");
  }

  async listRecent() {
    throw new Error("listRecent must be implemented");
  }
}

module.exports = {
  AdminActionLogRepository
};