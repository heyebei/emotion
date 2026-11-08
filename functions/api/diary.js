export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  const owner = env.GITHUB_OWNER || 'heyebei';
  const repo = env.GITHUB_REPO || 'emotion';
  const branch = env.GITHUB_BRANCH || 'main';

  if (!token) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Missing GITHUB_TOKEN in Cloudflare Pages environment variables.',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  try {
    const formData = await request.formData();
    const date = String(formData.get('date') || '').trim();
    const content = String(formData.get('content') || '').trim();
    const files = formData.getAll('images').filter((item) => item && typeof item.arrayBuffer === 'function' && item.size > 0);

    if (!date || !content || files.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing date, content, or uploaded images.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    const readmeResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/README.md?ref=${encodeURIComponent(branch)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'cloudflare-pages',
      },
    });

    if (!readmeResponse.ok) {
      throw new Error(`Failed to fetch README.md: ${readmeResponse.status}`);
    }

    const readmePayload = await readmeResponse.json();
    const readmeText = decodeBase64Content(readmePayload.content);

    const existingImageNames = await listImageNames(owner, repo, branch, token);
    const nextByDate = new Map();
    for (const name of existingImageNames) {
      const match = name.match(/^(\d{8})(\d{2})\.[A-Za-z0-9]+$/);
      if (!match) continue;
      const [, dateKey, seq] = match;
      if (dateKey === toDateKey(date)) {
        nextByDate.set(dateKey, Math.max(nextByDate.get(dateKey) || 0, Number(seq)));
      }
    }

    const imageNames = [];
    for (const [index, file] of files.entries()) {
      const base = toDateKey(date);
      const nextSeq = (nextByDate.get(base) || 0) + index + 1;
      const ext = getFileExtension(file.name || 'image.jpg');
      const imageName = `${base}${String(nextSeq).padStart(2, '0')}${ext}`;
      imageNames.push(imageName);

      const bytes = await file.arrayBuffer();
      await uploadToGitHub(owner, repo, branch, token, `image/${imageName}`, bytes, `Add image ${imageName}`);
    }

    const entryMarkdown = buildEntryMarkdown(date, content, imageNames);
    const updatedReadme = readmeText + (readmeText.endsWith('\n') ? '' : '\n') + entryMarkdown;

    const updateResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/README.md`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'cloudflare-pages',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Add diary entry for ${date}`,
        branch,
        sha: readmePayload.sha,
        content: encodeBase64String(updatedReadme),
      }),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`Failed to update README.md: ${updateResponse.status} ${errorText}`);
    }

    return new Response(JSON.stringify({
      ok: true,
      date,
      markdown: entryMarkdown,
      images: imageNames,
      message: 'Diary entry saved successfully.',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: error.message || 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

async function listImageNames(owner, repo, branch, token) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/image?ref=${encodeURIComponent(branch)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cloudflare-pages',
    },
  });

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((item) => item && item.type === 'file')
    .map((item) => item.name || '');
}

async function uploadToGitHub(owner, repo, branch, token, path, bytes, message) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cloudflare-pages',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      branch,
      content: uint8ToBase64(new Uint8Array(bytes)),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub upload failed for ${path}: ${response.status} ${text}`);
  }
}

function buildEntryMarkdown(dateValue, content, imageNames) {
  const imageBlock = imageNames.map((name) => `![image](image/${name})`).join('\n');
  return [
    `--${toChineseDate(dateValue)}`,
    '',
    content.trim(),
    '',
    imageBlock,
    '',
    '----',
    '',
  ].join('\n');
}

function toChineseDate(dateValue) {
  const [year, month, day] = dateValue.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

function toDateKey(dateValue) {
  const [year, month, day] = dateValue.split('-');
  return `${year}${month}${day}`;
}

function getFileExtension(fileName) {
  const lowerName = (fileName || '').toLowerCase();
  if (lowerName.endsWith('.png')) return '.png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return '.jpg';
  if (lowerName.endsWith('.webp')) return '.webp';
  if (lowerName.endsWith('.gif')) return '.gif';
  return '.jpg';
}

function decodeBase64Content(content) {
  if (!content) return '';
  const binary = atob(content.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64String(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function uint8ToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
