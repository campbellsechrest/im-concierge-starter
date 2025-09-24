import { logQuery } from '../lib/database/queries.js';

const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const testData = {
      userMessage: 'Test message',
      normalizedMessage: 'test message',
      responseAnswer: 'Test response',
      routing: { layer: 'test', rule: 'test-rule' },
      sources: [{ id: 'test', url: 'test.com', score: 0.5 }],
      responseTimeMs: 150,
      openai: { model: 'test-model' },
      errorMessage: null
    };

    console.log('Attempting to log test data...');
    const queryLogId = await logQuery(testData);
    console.log('Logging successful, ID:', queryLogId);

    return res.json({
      success: true,
      message: 'Test logging successful',
      queryLogId,
      testData
    });

  } catch (error) {
    console.error('Test logging failed:', error);

    return res.status(500).json({
      success: false,
      error: 'Test logging failed',
      message: error.message,
      code: error.code,
      stack: error.stack?.split('\n').slice(0, 5) // First 5 lines of stack
    });
  }
}