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
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorResponse(error) {
  if (error instanceof RequestError) {
    return jsonResponse({ error: error.message }, error.status);
  }

  console.error("Diary API failed:", error);
  return jsonResponse({ error: "服务器保存日记失败，请稍后重试。" }, 500);
}

function requireGitHubConfig(env) {
  const token = env.GITHUB_TOKEN || env.GITHUB_WRITE_TOKEN;
  if (!token || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
    throw new RequestError(
      503,
      "GitHub 写入配置尚未完成，请在 Cloudflare 环境变量中配置 GITHUB_TOKEN、GITHUB_OWNER 和 GITHUB_REPO。",
    );
  }

  return {
    token,
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
  };
}

function normalizeGithubPath(path) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function githubRequest(config, path, init = {}) {
  const response = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${normalizeGithubPath(path)}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "emotion-diary",
        ...(init.headers ?? {}),
      },
    },
  );

  if (!response.ok) {
    let detail = "GitHub API 请求失败。";
    try {
      const payload = await response.json();
      detail = payload?.message || detail;
    } catch {
      // ignore JSON parse failure and keep default detail.
    }

    throw new RequestError(
      response.status === 401 || response.status === 403 ? 401 : 500,
      detail,
    );
  }

  return response;
}

async function readGithubFile(config, path) {
  const response = await githubRequest(config, path, { method: "GET" });
  const payload = await response.json();

  if (!payload || typeof payload.content !== "string" || !payload.sha) {
    return null;
  }

  const binary = atob(payload.content.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return {
    sha: payload.sha,
    text: new TextDecoder("utf-8").decode(bytes),
  };
}

async function writeGithubFile(config, path, content, sha) {
  const bytes = new TextEncoder().encode(content);
  const binary = String.fromCharCode(...bytes);
  const payload = {
    message: `Update diary content in ${path}`,
    content: btoa(binary),
    ...(sha ? { sha } : {}),
  };

  await githubRequest(config, path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function writeGithubBinary(config, path, fileBytes) {
  const binary = String.fromCharCode(...fileBytes);
  const payload = {
    message: `Add diary image ${path}`,
    content: btoa(binary),
  };

  await githubRequest(config, path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function sameSecret(candidate, expected) {
  const encoder = new TextEncoder();
  const left = encoder.encode(candidate);
  const right = encoder.encode(expected);
  let difference = left.length ^ right.length;

  for (let index = 0; index < right.length; index += 1) {
    difference |= right[index] ^ (left[index] ?? 0);
  }

  return difference === 0;
}

function validateDate(value) {
  if (typeof value !== "string" || !ENTRY_DATE_PATTERN.test(value)) {
    throw new RequestError(400, "请选择有效的日记日期。");
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new RequestError(400, "请选择有效的日记日期。");
  }

  return value;
}

function detectImage(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: "jpg", contentType: "image/jpeg" };
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (pngSignature.every((byte, index) => bytes[index] === byte)) {
    return { extension: "png", contentType: "image/png" };
  }

  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return { extension: "webp", contentType: "image/webp" };
  }

  throw new RequestError(415, "照片必须是有效的 JPG、PNG 或 WebP 图片。");
}

function parseReadmeEntries(markdown, origin) {
  const sections = [];
  const lines = markdown.split(/\r?\n/);
  let current = null;

  for (const line of lines) {
    const match = line.match(DATE_HEADING_PATTERN);
    if (match) {
      if (current) {
        sections.push(current);
      }

      current = {
        date: `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`,
        lines: [],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push(current);
  }

  return sections
    .map((section) => {
      const imageLine = section.lines.find((line) => /!\[[^\]]*\]\(image\/[^)]+\)/.test(line));
      if (!imageLine) {
        return null;
      }

      const imageMatch = imageLine.match(/!\[[^\]]*\]\((image\/[^)]+)\)/);
      if (!imageMatch) {
        return null;
      }

      const imageFilename = imageMatch[1].replace(/^image\//, "");
      const text = section.lines
        .filter((line) => line !== imageLine && !/^---\s*$/.test(line))
        .join("\n")
        .trim();

      return {
        id: `${section.date}`,
        date: section.date,
        text,
        image: new URL(`/api/images/${encodeURIComponent(imageFilename)}`, origin).href,
        alt: "日记照片",
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.date.localeCompare(left.date));
}

async function saveEntry(request, env) {
  const config = requireGitHubConfig(env);
  const token = env.GITHUB_TOKEN || env.GITHUB_WRITE_TOKEN;
  if (typeof token !== "string" || token.length < 16) {
    throw new RequestError(503, "GitHub 写入令牌尚未配置，请联系网站管理员。");
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const candidate = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!sameSecret(candidate, token)) {
    throw new RequestError(401, "上传令牌不正确。");
  }

  const contentLength = Number(request.headers.get("Content-Length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_PHOTO_BYTES + 512_000
  ) {
    throw new RequestError(413, "上传内容过大，照片不能超过 12 MB。");
  }

  if (
    !request.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("multipart/form-data;")
  ) {
    throw new RequestError(415, "请使用照片上传表单提交日记。");
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    throw new RequestError(400, "无法读取上传内容，请重新选择照片后再试。");
  }

  const date = validateDate(form.get("date"));
  const text = form.get("text");
  const photo = form.get("photo");

  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.trim().length > MAX_TEXT_LENGTH
  ) {
    throw new RequestError(400, "日记文案不能为空，也不能超过 20,000 个字符。");
  }
  if (!(photo instanceof File) || photo.size === 0) {
    throw new RequestError(400, "请选择一张日记照片。");
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    throw new RequestError(413, "照片大小不能超过 12 MB。");
  }

  const imageBytes = new Uint8Array(await photo.arrayBuffer());
  const imageType = detectImage(imageBytes);
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const compactDate = date.replaceAll("-", "");
  const fileName = `${compactDate}_${timestamp.slice(8)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}.${imageType.extension}`;
  const imagePath = `${IMAGE_PREFIX}${fileName}`;
  const [year, month, day] = date.split("-");
  const markdownBlock = [
    `**${year}年${month}月${day}日**`,
    "",
    text.trim(),
    "",
    `![image](image/${fileName})`,
    "",
    "---",
    "",
  ].join("\n");

  let readmeFile;
  try {
    readmeFile = await readGithubFile(config, README_PATH);
  } catch (error) {
    if (!(error instanceof RequestError && error.status === 404)) {
      throw error;
    }
  }

  const readmeContent = readmeFile?.text ?? "";
  const nextReadme = readmeContent.trim().length > 0
    ? `${readmeContent.trimEnd()}\n\n${markdownBlock}`
    : markdownBlock;

  try {
    await writeGithubBinary(config, imagePath, imageBytes);
    await writeGithubFile(config, README_PATH, nextReadme, readmeFile?.sha);
  } catch (error) {
    console.error("GitHub diary save failed:", error);
    throw error;
  }

  return {
    id: `${date}-${timestamp}`,
    date,
    text: text.trim(),
    image: `https://raw.githubusercontent.com/${config.owner}/${config.repo}/main/${imagePath}`,
    alt: "日记照片",
  };
}

export async function onRequestGet(context) {
  try {
    const config = requireGitHubConfig(context.env);
    const readme = await readGithubFile(config, README_PATH);
    const entries = readme ? parseReadmeEntries(readme.text, new URL(context.request.url).origin) : [];
    return jsonResponse({ entries }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    const entry = await saveEntry(context.request, context.env);
    return jsonResponse(entry, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
