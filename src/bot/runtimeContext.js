const { createServiceContext } = require("../services/createServiceContext");

const serviceContext = createServiceContext();
let botClient = null;

function setBotClient(client) {
  botClient = client;
}

function getBotClient() {
  return botClient;
}

module.exports = {
  serviceContext,
  setBotClient,
  getBotClient
};