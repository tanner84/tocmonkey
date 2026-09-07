const { refreshMarketData } = require('./_market-ticker');

exports.handler = async function(event = {}) {
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const supplied = event?.headers?.['x-admin-password'] || event?.headers?.['X-Admin-Password'] || '';
  if (!adminPassword || supplied !== adminPassword) {
    console.warn('ticker-refresh-background rejected unauthorized invocation');
    return;
  }

  try {
    const result = await refreshMarketData({ force:true });
    console.log('ticker-refresh-background complete', {
      updatedAt:result.updatedAt || null,
      coverage:result.coverage || null,
      errors:result.errors || [],
    });
  } catch (error) {
    console.error('ticker-refresh-background failed:', error);
    throw error;
  }
};
