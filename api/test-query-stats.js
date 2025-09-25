import { getQueryStats } from '../lib/database/queries.js';

const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    console.log('Testing getQueryStats function...');
    const stats = await getQueryStats(24);
    console.log('getQueryStats result:', stats);

    return res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('getQueryStats error:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
      stack: error.stack?.split('\n').slice(0, 10)
    });
  }
}