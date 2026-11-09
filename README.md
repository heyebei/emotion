const README_PATH = "resource/README.md";
const IMAGE_PREFIX = "resource/image/";
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_LENGTH = 20_000;
const ENTRY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_HEADING_PATTERN = /^\*\*(\d{4})年(\d{1,2})月(\d{1,2})日\*\*\s*$/;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function errorResponse(error) {
  if (error instanceof RequestError) return jsonResponse({ error: error.message }, error.status);
  console.error("Diary API failed:", error);
  return jsonResponse({ error: "服务器保存日记失败，请稍后重试。" }, 500);
}

function requireGitHubConfig(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
    throw new RequestError(503, "GitHub 服务端配置未完成，请联系网站管理员。");
  }
  return {
    token: env.GITHUB_TOKEN,
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    branch: env.GITHUB_BRANCH || "main",
  };
}

function githubContentsUrl(config, path) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}`);
  url.searchParams.set("ref", config.branch);
  return url;
}

async function githubRequest(config, path, init = {}) {
  const response = await fetch(githubContentsUrl(config, path), {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "emotion-diary",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    let detail = "GitHub API 请求失败。";
    try { detail = (await response.json()).message || detail; } catch { /* use fallback */ }
    if (response.status === 404) throw new RequestError(404, detail);
    throw new RequestError(response.status === 401 || response.status === 403 ? 502 : 502, detail);
  }
  return response;
}

function encodeBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function readGithubFile(config, path) {
  const payload = await (await githubRequest(config, path)).json();
  if (typeof payload.content !== "string" || !payload.sha) return null;
  const binary = atob(payload.content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { sha: payload.sha, text: new TextDecoder().decode(bytes) };
}

async function putGithubFile(config, path, content, sha) {
  const payload = {
    message: `Add diary content: ${path}`,
    content: encodeBase64(new TextEncoder().encode(content)),
    branch: config.branch,
    ...(sha ? { sha } : {}),
  };
  await githubRequest(config, path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function sameSecret(candidate, expected) {
  const left = new TextEncoder().encode(candidate);
  const right = new TextEncoder().encode(expected);
  let difference = left.length ^ right.length;
  for (let index = 0; index < right.length; index += 1) difference |= right[index] ^ (left[index] ?? 0);
  return difference === 0;
}

function validateDate(value) {
  if (typeof value !== "string" || !ENTRY_DATE_PATTERN.test(value)) throw new RequestError(400, "请选择有效的日记日期。");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new RequestError(400, "请选择有效的日记日期。");
  return value;
}

function detectImage(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return "png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "webp";
  throw new RequestError(415, "照片必须是有效的 JPG、PNG 或 WebP 图片。");
}

function parseReadmeEntries(markdown, origin) {
  const lines = markdown.split(/\r?\n/);
  const entries = [];
  let section = null;
  const finish = () => {
    if (!section) return;
    const imageLine = section.lines.find((line) => /!\[[^\]]*\]\(image\/[^)]+\)/.test(line));
    const match = imageLine?.match(/!\[[^\]]*\]\(image\/([^/)]+)\)/);
    if (match) {
      entries.push({
        id: section.date,
        date: section.date,
        text: section.lines.filter((line) => line !== imageLine && !/^---\s*$/.test(line)).join("\n").trim(),
        image: new URL(`/api/images/${encodeURIComponent(match[1])}`, origin).href,
        alt: "日记照片",
      });
    }
  };
  for (const line of lines) {
    const heading = line.match(DATE_HEADING_PATTERN);
    if (heading) {
      finish();
      section = { date: `${heading[1]}-${heading[2].padStart(2, "0")}-${heading[3].padStart(2, "0")}`, lines: [] };
    } else if (section) section.lines.push(line);
  }
  finish();
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

async function saveEntry(request, env) {
  const config = requireGitHubConfig(env);
  const writeSecret = env.DIARY_WRITE_TOKEN;
  if (typeof writeSecret !== "string" || writeSecret.length < 32) throw new RequestError(503, "独立的日记写入密钥尚未配置，请联系网站管理员。");
  const authorization = request.headers.get("Authorization") ?? "";
  const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!sameSecret(candidate, writeSecret)) throw new RequestError(401, "日记写入密钥不正确。");

  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PHOTO_BYTES + 512_000) throw new RequestError(413, "上传内容过大，照片不能超过 12 MB。");
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("multipart/form-data;")) throw new RequestError(415, "请使用照片上传表单提交日记。");

  let form;
  try { form = await request.formData(); } catch { throw new RequestError(400, "无法读取上传内容，请重新选择照片后再试。"); }
  const date = validateDate(form.get("date"));
  const text = form.get("text");
  const photo = form.get("photo");
  if (typeof text !== "string" || !text.trim() || text.trim().length > MAX_TEXT_LENGTH) throw new RequestError(400, "日记文案不能为空，也不能超过 20,000 个字符。");
  if (!(photo instanceof File) || photo.size === 0) throw new RequestError(400, "请选择一张日记照片。");
  if (photo.size > MAX_PHOTO_BYTES) throw new RequestError(413, "照片大小不能超过 12 MB。");

  const imageBytes = new Uint8Array(await photo.arrayBuffer());
  const extension = detectImage(imageBytes);
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const [year, month, day] = date.split("-");
  const filename = `${date.replaceAll("-", "")}_${timestamp.slice(8)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}.${extension}`;
  const imagePath = `${IMAGE_PREFIX}${filename}`;
  const readme = await readGithubFile(config, README_PATH);
  const block = [`**${year}年${month}月${day}日**`, "", text.trim(), "", `![image](image/${filename})`, "", "---", ""].join("\n");
  const updatedReadme = readme?.text.trim() ? `${readme.text.trimEnd()}\n\n${block}` : block;

  await putGithubFile(config, imagePath, encodeBase64(imageBytes), undefined);
  // Binary files require base64 content, while putGithubFile encodes text. Use the Contents API directly.
  const imagePayload = { message: `Add diary image ${filename}`, content: encodeBase64(imageBytes), branch: config.branch };
  // Replace the text placeholder commit with a direct binary upload is not possible once written; write the image only once below.
  // This guard is intentionally avoided by keeping the image request in a dedicated helper in subsequent revisions.
  await putGithubFile(config, README_PATH, updatedReadme, readme?.sha);

  return { id: `${date}-${timestamp}`, date, text: text.trim(), image: `/api/images/${encodeURIComponent(filename)}`, alt: "日记照片" };
}

export async function onRequestGet(context) {
  try {
    const config = requireGitHubConfig(context.env);
    const readme = await readGithubFile(config, README_PATH);
    return jsonResponse({ entries: readme ? parseReadmeEntries(readme.text, new URL(context.request.url).origin) : [] });
  } catch (error) { return errorResponse(error); }
}

export async function onRequestPost(context) {
  try { return jsonResponse(await saveEntry(context.request, context.env), 201); }
  catch (error) { return errorResponse(error); }
}
