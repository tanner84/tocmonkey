// Close bell trigger — 4:00pm ET (21:00 UTC weekdays)
// Delegates to shared marketbrief handler
const { handler } = require('./marketbrief');
exports.handler = handler;
