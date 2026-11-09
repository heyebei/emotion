const DIARY_URL = new URL("./resource/README.md", document.baseURI);
const ENTRIES_URL = new URL("./api/entries", document.baseURI);
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;
const DATE_PATTERN =
  /^\s*(?:\*\*\s*)?(?:--+\s*)?(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日(?:\s*\*\*)?\s*$/;

const timeline = document.querySelector("#timeline");
const diaryCard = document.querySelector("#diary-card");
const diaryPanel = document.querySelector("#diary-panel");
const cardPosition = document.querySelector("#card-position");
const entryCount = document.querySelector("#entry-count");
const readingLabel = document.querySelector("#reading-label");
const previousButton = document.querySelector("#previous-button");
const nextButton = document.querySelector("#next-button");
const statusMessage = document.querySelector("#status-message");

let entries = [];
let currentIndex = 0;
let statusTimeout;

function parseDiary(markdown) {
  const content = markdown.replace(/<!--[\s\S]*?-->/g, "");
  const lines = content.split(/\r?\n/);
  const headings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(DATE_PATTERN);
    if (match) {
      headings.push({
        line: index,
        date: `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`,
      });
    }
  }

  return headings.flatMap((heading, index) => {
    const endLine = headings[index + 1]?.line ?? lines.length;
    const section = lines.slice(heading.line + 1, endLine).join("\n");
    const imageMatch = IMAGE_PATTERN.exec(section);
    IMAGE_PATTERN.lastIndex = 0;

    if (!imageMatch) {
      return [];
    }

    const text = cleanCaption(section.slice(0, imageMatch.index));
    const imagePath = imageMatch[2].trim().replace(/^<|>$/g, "");
    const imageUrl = new URL(imagePath, DIARY_URL);
    const resourceImagePrefix = new URL("./image/", DIARY_URL).pathname;
    const imageKey = imageUrl.pathname.startsWith(resourceImagePrefix)
      ? imageUrl.pathname.slice(resourceImagePrefix.length)
      : null;

    return [
      {
        date: heading.date,
        text,
        image: imageKey
          ? new URL(`/api/images/${imageKey}`, document.baseURI).href
          : imageUrl.href,
        fallbackImage: imageKey ? imageUrl.href : null,
        alt: imageMatch[1].trim() || "日记照片",
      },
    ];
  }).reverse();
}

function cleanCaption(markdown) {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function formatDate(date, options) {
  return new Intl.DateTimeFormat(
    "zh-CN",
    options,
  ).format(new Date(`${date}T00:00:00`));
}

function buildTimeline() {
  timeline.replaceChildren();

  entries.forEach((entry, index) => {
    const button = document.createElement("button");
    button.className = "timeline-item";
    button.type = "button";
    button.dataset.index = String(index);
    button.setAttribute("aria-label", `查看 ${formatDate(entry.date)} 的日记`);

    const marker = document.createElement("span");
    marker.className = "timeline-marker";
    marker.setAttribute("aria-hidden", "true");

    const date = document.createElement("span");
    date.className = "timeline-date";
    date.textContent = formatDate(entry.date, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const number = document.createElement("span");
    number.className = "timeline-index";
    number.textContent = String(index + 1).padStart(2, "0");

    button.append(marker, date, number);
    button.addEventListener("click", () => selectEntry(index));
    timeline.append(button);
  });
}

function renderEntry() {
  const entry = entries[currentIndex];
  const figure = document.createElement("div");
  figure.className = "photo-wrap";

  const image = document.createElement("img");
  image.className = "diary-photo";
  image.src = entry.image;
  image.alt = entry.alt;
  image.loading = "eager";
  if (entry.fallbackImage) {
    image.addEventListener(
      "error",
      () => {
        image.src = entry.fallbackImage;
      },
      { once: true },
    );
  }
  figure.append(image);

  const photoCaption = document.createElement("span");
  photoCaption.className = "photo-caption";
  photoCaption.textContent = "A MOMENT IN TIME";
  figure.append(photoCaption);

  const copy = document.createElement("section");
  copy.className = "entry-copy";

  const date = document.createElement("p");
  date.className = "entry-date";
  date.textContent = formatDate(entry.date, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  copy.append(date);

  const text = document.createElement("p");
  text.className = entry.text ? "entry-text" : "empty-copy";
  text.textContent = entry.text || "那一天的心情，留在了这张照片里。";
  copy.append(text);

  diaryCard.replaceChildren(figure, copy);
  cardPosition.textContent = `${String(currentIndex + 1).padStart(2, "0")} / ${String(entries.length).padStart(2, "0")}`;
  entryCount.textContent = `${entries.length} 篇`;
  readingLabel.textContent = formatDate(entry.date, {
    year: "numeric",
    month: "long",
  });
  previousButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === entries.length - 1;

  timeline.querySelectorAll(".timeline-item").forEach((item, index) => {
    if (index === currentIndex) {
      item.setAttribute("aria-current", "date");
    } else {
      item.removeAttribute("aria-current");
    }
  });

  const activeItem = timeline.querySelector(
    `[data-index="${currentIndex}"]`,
  );
  if (activeItem) {
    if (window.matchMedia("(max-width: 760px)").matches) {
      timeline.scrollTo({
        left:
          activeItem.offsetLeft -
          (timeline.clientWidth - activeItem.offsetWidth) / 2,
        behavior: "smooth",
      });
    } else {
      timeline.scrollTo({
        top:
          activeItem.offsetTop -
          (timeline.clientHeight - activeItem.offsetHeight) / 2,
        behavior: "smooth",
      });
    }
  }
}

function selectEntry(index) {
  if (index < 0 || index >= entries.length || index === currentIndex) {
    return;
  }

  currentIndex = index;
  renderEntry();

  if (window.matchMedia("(max-width: 760px)").matches) {
    diaryPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function showStatus(message) {
  window.clearTimeout(statusTimeout);
  statusMessage.textContent = message;
  statusMessage.hidden = false;
  statusTimeout = window.setTimeout(() => {
    statusMessage.hidden = true;
  }, 3600);
}

function showLoadError(message, detail) {
  const error = document.createElement("div");
  error.className = "load-error";
  const title = document.createElement("strong");
  title.textContent = message;
  const explanation = document.createElement("span");
  explanation.textContent = detail;
  error.append(title, explanation);
  diaryPanel.replaceChildren(error);
}

previousButton.addEventListener("click", () => selectEntry(currentIndex - 1));
nextButton.addEventListener("click", () => selectEntry(currentIndex + 1));

document.addEventListener("keydown", (event) => {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  ) {
    return;
  }

  if (event.key === "ArrowLeft") {
    selectEntry(currentIndex - 1);
  } else if (event.key === "ArrowRight") {
    selectEntry(currentIndex + 1);
  }
});

async function loadDiary() {
  try {
    const response = await fetch(DIARY_URL);
    if (!response.ok) {
      throw new Error(`读取日记失败（HTTP ${response.status}）`);
    }

    const markdown = await response.text();
    entries = parseDiary(markdown);
    let remoteEntries = [];

    try {
      const remoteResponse = await fetch(ENTRIES_URL);
      if (!remoteResponse.ok) {
        throw new Error(`读取云端日记失败（HTTP ${remoteResponse.status}）`);
      }

      const result = await remoteResponse.json();
      if (!Array.isArray(result.entries)) {
        throw new Error("云端日记接口返回了无效的数据格式。");
      }
      remoteEntries = result.entries;
    } catch (error) {
      console.error("无法加载云端日记：", error);
      showStatus("云端日记暂时无法读取，当前显示本地 Markdown 日记。");
    }

    entries = [...entries, ...remoteEntries].sort((a, b) => {
      const dateOrder = b.date.localeCompare(a.date);
      if (dateOrder !== 0) {
        return dateOrder;
      }

      return String(b.id ?? "").localeCompare(String(a.id ?? ""));
    });
    if (entries.length === 0) {
      throw new Error("没有找到包含日期和图片的日记卡片。");
    }

    const requestedEntry = new URL(window.location.href).searchParams.get("entry");
    const requestedIndex = entries.findIndex(
      (entry) => entry.id === requestedEntry,
    );
    currentIndex = requestedIndex === -1 ? 0 : requestedIndex;
    buildTimeline();
    renderEntry();
  } catch (error) {
    console.error("无法加载日记卡片：", error);
    showLoadError(
      "暂时无法读取日记",
      "请通过本地网页服务器或已部署的网站打开此页面，并确认 resource/README.md 可访问。",
    );
  }
}

loadDiary();
