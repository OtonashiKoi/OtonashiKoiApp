"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");
(async () => {
  const c = new MongoClient(config.storage.mongoUri);
  await c.connect();
  const db = c.db(config.storage.mongoDbName);
  const items = await db.collection("items").find({ weaponType: { $exists: true, $ne: null, $ne: "" } }).sort({ weaponType: 1 }).toArray();
  items.forEach(i => console.log(
    "type=" + i.weaponType +
    " | " + i.name +
    " | slot=" + i.equipSlot +
    " | 2h=" + i.isTwoHanded +
    " | enabled=" + i.enabled
  ));
  console.log("total:", items.length);
  await c.close();
})().catch(console.error);
