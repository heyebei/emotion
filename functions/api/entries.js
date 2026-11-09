const JOURNAL_PREFIX = "resource/journal/";
const IMAGE_PREFIX = "resource/image/";
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_LENGTH = 20_000;
const ENTRY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_MARKDOWN_PATTERN =
  /^\*\*(\d{4})年(\d{2})月(\d{2})日\*\*\s*$/m;
const ENTRY_IMAGE_PATTERN =
  /^!\[image\]\((?:\.\.\/){4}image\/(\d{8}_\d{6}_[0-9a-f]{12}\.(?:jpg|png|webp))\)\s*$/m;

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

function requireBucket(env) {
  if (!env.DIARY_BUCKET) {
    throw new RequestError(503, "日记存储尚未配置，请联系网站管理员。");
  }
  return env.DIARY_BUCKET;
}

function parseEntry(key, markdown, origin) {
  const dateMatch = markdown.match(ENTRY_MARKDOWN_PATTERN);
  const imageMatch = markdown.match(ENTRY_IMAGE_PATTERN);
  if (!dateMatch || !imageMatch) {
    console.error(`Ignoring invalid diary Markdown object: ${key}`);
    return null;
  }

  const imageName = imageMatch[1];

  const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  const imageIndex = markdown.indexOf(imageMatch[0]);
  const headingIndex = markdown.indexOf(dateMatch[0]);
  const text = markdown
    .slice(headingIndex + dateMatch[0].length, imageIndex)
    .trim();

  return {
    id: key.slice(JOURNAL_PREFIX.length, -".md".length),
    date,
    text,
    image: new URL(`/api/images/${encodeURIComponent(imageName)}`, origin).href,
    alt: "日记照片",
  };
}

async function readDiaryEntries(bucket, origin) {
  const entries = [];
  let cursor;

  do {
    const page = await bucket.list({
      prefix: JOURNAL_PREFIX,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });

    for (let start = 0; start < page.objects.length; start += 40) {
      const batch = page.objects.slice(start, start + 40);
      const parsed = await Promise.all(
        batch.map(async (object) => {
          if (!object.key.endsWith(".md")) {
            return null;
          }

          const stored = await bucket.get(object.key);
          if (!stored) {
            return null;
          }

          return parseEntry(object.key, await stored.text(), origin);
        }),
      );
      entries.push(...parsed.filter(Boolean));
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  entries.sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      right.id.localeCompare(left.id),
  );
  return entries;
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
  const bucket = requireBucket(env);
  const token = env.DIARY_WRITE_TOKEN;
  if (typeof token !== "string" || token.length < 32) {
    throw new RequestError(503, "日记上传密钥尚未配置，请联系网站管理员。");
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const candidate = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!sameSecret(candidate, token)) {
    throw new RequestError(401, "上传密钥不正确。");
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
  const uniqueId = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const compactDate = date.replaceAll("-", "");
  const imageId = uniqueId.replaceAll("-", "").slice(0, 12);
  const photoName = [
    `${compactDate}_${timestamp.slice(8)}`,
    imageId,
  ].join("_") + `.${imageType.extension}`;
  const imageKey = `${IMAGE_PREFIX}${photoName}`;
  const [year, month, day] = date.split("-");
  const entryId = `${date}-${timestamp}-${uniqueId}`;
  const markdownKey = `${JOURNAL_PREFIX}${year}/${month}/${day}/${entryId}.md`;
  const imagePath = `../../../../image/${photoName}`;
  const markdown = [
    `**${year}年${month}月${day}日**`,
    "",
    text.trim(),
    "",
    `![image](${imagePath})`,
    "",
    "---",
    "",
  ].join("\n");

  await bucket.put(imageKey, imageBytes, {
    httpMetadata: {
      contentType: imageType.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });

  try {
    await bucket.put(markdownKey, markdown, {
      httpMetadata: {
        contentType: "text/markdown; charset=utf-8",
      },
    });
  } catch (error) {
    try {
      await bucket.delete(imageKey);
    } catch (cleanupError) {
      console.error("Failed to clean up an orphaned diary photo:", cleanupError);
    }
    throw error;
  }

  return {
    id: markdownKey.slice(JOURNAL_PREFIX.length, -".md".length),
    date,
    text: text.trim(),
    image: new URL(
      `/api/images/${encodeURIComponent(photoName)}`,
      request.url,
    ).href,
    alt: "日记照片",
  };
}

export async function onRequestGet(context) {
  try {
    const bucket = requireBucket(context.env);
    const entries = await readDiaryEntries(
      bucket,
      new URL(context.request.url).origin,
    );
    return Response.json(
      { entries },
      {
        headers: {
          "Cache-Control": "public, max-age=30, stale-while-revalidate=30",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
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
