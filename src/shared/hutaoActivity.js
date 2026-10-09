"use strict";
const STARTS_AT = "2026-10-08T08:25:13.000Z";
const ENDS_AT = "2026-10-15T08:25:13.000Z";
function isOpen(now = Date.now()) { return now >= Date.parse(STARTS_AT) && now < Date.parse(ENDS_AT); }
function view() { return { startsAt: STARTS_AT, endsAt: ENDS_AT }; }
module.exports = { STARTS_AT, ENDS_AT, isOpen, view };
