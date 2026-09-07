"use strict";
let ownership = null;
function setRuntimeOwnership(lease) { ownership = lease; }
function assertRuntimeOwnership() { ownership?.assertOwned(); }
module.exports = { setRuntimeOwnership, assertRuntimeOwnership };
