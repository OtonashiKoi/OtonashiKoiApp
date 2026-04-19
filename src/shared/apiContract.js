const API_CONTRACT = Object.freeze({
  name: "equipmentGAME-public-api",
  version: "v1",
  releasedAt: "2026-04-19",
  compatibility: "additive-only"
});

function setApiContractHeaders(res) {
  res.setHeader("X-API-Contract-Name", API_CONTRACT.name);
  res.setHeader("X-API-Contract-Version", API_CONTRACT.version);
  res.setHeader("X-API-Contract-Compatibility", API_CONTRACT.compatibility);
}

module.exports = {
  API_CONTRACT,
  setApiContractHeaders
};

