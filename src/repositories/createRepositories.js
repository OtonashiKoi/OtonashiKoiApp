const { createMongoRepositories } = require("../adapters/mongo/createMongoRepositories");

function createRepositories() {
  return createMongoRepositories();
}

module.exports = {
  createRepositories
};
