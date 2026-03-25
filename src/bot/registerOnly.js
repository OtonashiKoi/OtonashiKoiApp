require("dotenv").config();

const { registerCommands } = require("./registerCommands");

registerCommands()
  .then((ok) => {
    if (!ok) {
      process.exitCode = 1;
      return;
    }
    console.log("[Discord] registerOnly finished.");
  })
  .catch((error) => {
    console.error("[Discord] registerOnly failed", error);
    process.exit(1);
  });
