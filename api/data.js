// Vercel serverless function — Gist read/write proxy
// GIST_TOKEN and GIST_ID stored as Vercel environment variables

const GIST_ID = process.env.GIST_ID;
const GIST_TOKEN = process.env.GIST_TOKEN;
const GIST_FILE = 'lum-data.json';
const GITHUB_API = 'https://api.github.com';

async function gistFetch(method, body) {
  const res = await fetch(`${GITHUB_API}/gists/${GIST_ID}`, {
    method,
    headers: {
      Authorization: `token ${GIST_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'luminora-cmo-portal'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  return res.json();
}

// Explicitly read + parse raw body — req.body is undefined in Vercel ESM runtime
async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    // Already parsed by Vercel's body-parser (non-ESM path)
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  // ESM path: body is a readable stream, consume it manually
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) throw new Error('Empty request body');
  return JSON.parse(text);
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const gist = await gistFetch('GET');
      const content = gist.files?.[GIST_FILE]?.content;
      if (!content) {
        return res.status(200).json({});
      }
      return res.status(200).json(JSON.parse(content));
    }

    if (req.method === 'POST') {
      const data = await readJsonBody(req);
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Invalid or empty JSON body' });
      }
      await gistFetch('PATCH', {
        files: { [GIST_FILE]: { content: JSON.stringify(data, null, 2) } }
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('API error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
