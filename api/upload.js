// /api/upload.js — upload an image to assets/post-images/ in the GitHub repo
// Accepts multipart/form-data with field "file" (and optional "filename")

const https = require('https');

function parseMultipart(body, boundary) {
  const parts = [];
  const boundaryBuf = Buffer.from('--' + boundary);
  let start = 0;
  while (start < body.length) {
    const boundaryIdx = body.indexOf(boundaryBuf, start);
    if (boundaryIdx === -1) break;
    const headerStart = boundaryIdx + boundaryBuf.length + 2; // skip \r\n
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const headers = body.slice(headerStart, headerEnd).toString();
    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(boundaryBuf, dataStart);
    const dataEnd = nextBoundary === -1 ? body.length : nextBoundary - 2; // trim \r\n
    const data = body.slice(dataStart, dataEnd);
    parts.push({ headers, data });
    start = nextBoundary === -1 ? body.length : nextBoundary;
  }
  return parts;
}

function githubRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'luminora-cmo-portal',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not set' });

  const OWNER = 'nodoguro989';
  const REPO  = 'luminora-cmo-dashboard';
  const FOLDER = 'assets/post-images';

  // Read raw body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  // Parse content-type for boundary
  const ct = req.headers['content-type'] || '';
  const boundaryMatch = ct.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) return res.status(400).json({ error: 'No multipart boundary' });
  const boundary = boundaryMatch[1];

  const parts = parseMultipart(rawBody, boundary);
  let fileData = null;
  let filename = null;

  for (const part of parts) {
    const nameMatch = part.headers.match(/name="([^"]+)"/);
    const filenameMatch = part.headers.match(/filename="([^"]+)"/);
    if (nameMatch && nameMatch[1] === 'file' && filenameMatch) {
      fileData = part.data;
      filename = filenameMatch[1];
    } else if (nameMatch && nameMatch[1] === 'filename') {
      filename = part.data.toString().trim();
    }
  }

  if (!fileData || !filename) {
    return res.status(400).json({ error: 'Missing file or filename' });
  }

  // Sanitise filename
  filename = filename.replace(/[^a-zA-Z0-9._\-]/g, '-');
  const filePath = `${FOLDER}/${filename}`;
  const content = fileData.toString('base64');

  // Check if file already exists (need SHA to update)
  let sha;
  const existing = await githubRequest('GET', `/repos/${OWNER}/${REPO}/contents/${filePath}`, token);
  if (existing.status === 200) sha = existing.body.sha;

  // Commit file
  const commitBody = {
    message: `Upload image: ${filename}`,
    content,
    ...(sha ? { sha } : {}),
  };
  const result = await githubRequest('PUT', `/repos/${OWNER}/${REPO}/contents/${filePath}`, token, commitBody);

  if (result.status !== 200 && result.status !== 201) {
    return res.status(500).json({ error: 'GitHub commit failed', detail: result.body });
  }

  const publicUrl = `assets/post-images/${filename}`;
  return res.status(200).json({ url: publicUrl, filename });
};
