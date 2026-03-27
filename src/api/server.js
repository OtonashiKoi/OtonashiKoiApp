const express = require("express");
const path = require("path");
const { createServiceContext } = require("../services/createServiceContext");
const { isAppError } = require("../shared/errors");
const { fail } = require("../shared/response");
const { createAdminConsoleRoutes } = require("./routes/adminConsoleRoutes");
const { createAdminPlayerRoutes } = require("./routes/adminPlayerRoutes");
const { createHealthRoutes } = require("./routes/healthRoutes");

function createApiServer() {
  const app = express();
  const serviceContext = createServiceContext();

  app.use(express.json());
  app.use("/static", express.static(path.resolve(__dirname, "../web/public")));
  app.use(createHealthRoutes());
  app.use(createAdminConsoleRoutes(serviceContext));
  app.use(createAdminPlayerRoutes(serviceContext));

  app.use((error, _req, res, _next) => {
    console.error("[API] request error", error);
    if (isAppError(error)) {
      res.status(error.status).json(fail(error.code, error.message));
      return;
    }

    res.status(500).json(fail("INTERNAL_ERROR", "Unexpected server error."));
  });

  return app;
}

module.exports = {
  createApiServer
};