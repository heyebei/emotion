const IMAGE_PREFIX = "resource/image/";
const IMAGE_NAME_PATTERN = /\.(?:gif|jpe?g|png|webp)$/i;
const SAFE_PATH_SEGMENT = /^[\p{L}\p{N}._ ()-]+$/u;

export async function onRequestGet({ params, env }) {
  const segments = params.key;
  const imagePath = Array.isArray(segments) ? segments.join("/") : "";
  const filename = segments?.at(-1);

  if (
    !Array.isArray(segments) ||
    segments.length === 0 ||
    segments.some(
      (segment) =>
        typeof segment !== "string" ||
        segment === "." ||
        segment === ".." ||
        !SAFE_PATH_SEGMENT.test(segment),
    ) ||
    typeof filename !== "string" ||
    !IMAGE_NAME_PATTERN.test(filename) ||
    !env.DIARY_BUCKET
  ) {
    return new Response("Not found", {
      status: 404,
      headers: { "X-Content-Type-Options": "nosniff" },
    });
  }

  try {
    const image = await env.DIARY_BUCKET.get(`${IMAGE_PREFIX}${imagePath}`);
    if (!image) {
      return new Response("Not found", { status: 404 });
    }

    const extension = filename.split(".").at(-1).toLowerCase();
    const fallbackContentType = {
      gif: "image/gif",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    }[extension];

    return new Response(image.body, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": fallbackContentType,
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    console.error("Failed to load diary photo:", error);
    return Response.json(
      { error: "无法读取日记照片。" },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
