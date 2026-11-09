const STARTER_PATH = "resource/README.md";
const IMAGE_PREFIX = "resource/image/";
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_LENGTH = 20_000;
const ENTRY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function requireGithubConfig(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
    throw new RequestError(
      503,
      "GitHub 仓库写入配置尚未完成，请联系网站管理员。",
    );
  }

  return {
    token: env.GITHUB_TOKEN,
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
  };
}

function githubContentPath(path) {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function githubRequest(config, path, init = {}) {
  const response = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${githubContentPath(path)}`,
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
    let details = "GitHub API 请求失败。";
    try {
      const payload = await response.json();
      details = payload?.message || details;
    } catch {
      // ignore JSON parse errors and fall back to the default message.
    }

    throw new RequestError(
      response.status === 401 || response.status === 403 ? 401 : 500,
      details,
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

  const normalized = payload.content.replace(/\n/g, "");
  const binary = atob(normalized);
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
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function writeGithubImage(config, path, fileBytes) {
  const binary = String.fromCharCode(...fileBytes);
  const payload = {
    message: `Add diary image ${path}`,
    content: btoa(binary),
  };

  await githubRequest(config, path, {
    method: "PUT",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
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

async function saveEntry(request, env) {
  const config = requireGithubConfig(env);
  const token = env.GITHUB_WRITE_TOKEN || env.GITHUB_TOKEN;
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
  const imageKey = `${IMAGE_PREFIX}${fileName}`;
  const [year, month, day] = date.split("-");
  const markdown = [
    `**${year}年${month}月${day}日**`,
    "",
    text.trim(),
    "",
    `![image](image/${fileName})`,
    "",
    "---",
    "",
  ].join("\n");

  try {
    await writeGithubImage(config, imageKey, imageBytes);
  } catch (error) {
    console.error("Failed to upload diary image to GitHub:", error);
    throw error;
  }

  let fileRecord;
  try {
    fileRecord = await readGithubFile(config, STARTER_PATH);
  } catch (error) {
    if (!(error instanceof RequestError && error.status === 404)) {
      throw error;
    }
  }

  let finalReadme = fileRecord?.text ?? "";
  if (finalReadme.trim().length > 0) {
    finalReadme = finalReadme.trimEnd() + "\n\n" + markdown;
  } else {
    finalReadme = markdown;
  }

  try {
    await writeGithubFile(
      config,
      STARTER_PATH,
      finalReadme,
      fileRecord?.sha,
    );
  } catch (error) {
    try {
      await githubRequest(config, imageKey, { method: "DELETE", body: JSON.stringify({ message: `Remove orphaned diary image ${imageKey}`, sha: (await readGithubFile(config, imageKey)).sha }) });
    } catch {
      // best effort cleanup only.
    }
    throw error;
  }

  return {
    id: `${date}-${timestamp}`,
    date,
    text: text.trim(),
    image: `https://raw.githubusercontent.com/${config.owner}/${config.repo}/main/${imageKey}`,
    alt: "日记照片",
  };
}

export async function onRequestGet() {
  return jsonResponse({ entries: [] }, 200);
}

export async function onRequestPost(context) {
  try {
    const entry = await saveEntry(context.request, context.env);
    return jsonResponse(entry, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET") {
      return onRequestGet(url, env);
    }
    if (request.method === "POST") {
      return onRequestPost({ request, env });
    }
    return new Response("Method not allowed", { status: 405 });
  },
};
'} ivoq to=functions.create_or_update_file  ар                   
{