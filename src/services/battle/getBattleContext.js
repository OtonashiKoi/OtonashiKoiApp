"use strict";

function getServiceContext() {
  return require("../runtimeContext").serviceContext;
}
module.exports = { getServiceContext };
