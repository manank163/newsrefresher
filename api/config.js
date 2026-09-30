import { publicConfig } from '../lib/config.js';

export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=300, s-maxage=3600');
  res.end(JSON.stringify({ ...publicConfig(), demo: process.env.DEMO_MODE === '1' }));
}
