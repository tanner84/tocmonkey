// Open bell trigger — 9:30am ET (14:30 UTC weekdays)
// Delegates to shared marketbrief handler
const { handler } = require('./marketbrief');
exports.handler = handler;
