const PAGE_SIZE = 1;

const timeline = document.getElementById('timeline');
const monthFilter = document.getElementById('month-filter');
const pagination = document.getElementById('pagination');
const previousButton = document.getElementById('previous-page');
const nextButton = document.getElementById('next-page');
const pageStatus = document.getElementById('page-status');
const paginationLabel = document.getElementById('pagination-label');
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxClose = document.getElementById('lightbox-close');
const lightboxPrevious = document.getElementById('lightbox-prev');
const lightboxNext = document.getElementById('lightbox-next');

let allEntries = [];
let visibleEntries = [];
let currentPage = 0;
let lightboxImages = [];
let lightboxIndex = 0;

fetch('./README.md')
  .then((response) => {
    if (!response.ok) throw new Error(`README.md loading failed: ${response.status}`);
    return response.text();
  })
  .then((markdown) => {
    allEntries = parseEntries(markdown);
    if (allEntries.length === 0) {
      showMessage('README.md 中没有找到带日期的日记内容。');
      return;
    }
    populateMonthFilter();
    filterEntries();
  })
  .catch((error) => {
    console.error(error);
    showMessage('无法加载 README.md。请确认 GitHub Pages 已启用，并通过网页地址访问此页面。');
  });

monthFilter.addEventListener('change', () => {
  currentPage = 0;
  filterEntries();
});
previousButton.addEventListener('click', () => changePage(-1));
nextButton.addEventListener('click', () => changePage(1));
lightboxClose.addEventListener('click', closeLightbox);
lightboxPrevious.addEventListener('click', () => moveLightbox(-1));
lightboxNext.addEventListener('click', () => moveLightbox(1));
lightbox.addEventListener('click', (event) => {
  if (event.target === lightbox) closeLightbox();
});
lightbox.addEventListener('close', () => {
  document.body.classList.remove('dialog-open');
});
document.addEventListener('keydown', (event) => {
  if (!lightbox.open) return;
  if (event.key === 'Escape') closeLightbox();
  if (event.key === 'ArrowLeft') moveLightbox(-1);
  if (event.key === 'ArrowRight') moveLightbox(1);
});

function parseEntries(markdown) {
  // Ignore archived/commented-out entries so only active Markdown content is shown.
  const activeMarkdown = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const entriesByDate = new Map();
  let current = null;

  for (const rawLine of activeMarkdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const dateMatch = line.match(/^--\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*$/);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      const dateKey = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      if (!entriesByDate.has(dateKey)) {
        entriesByDate.set(dateKey, {
          dateKey,
          date: `${year}年${Number(month)}月${Number(day)}日`,
          monthKey: `${year}-${month.padStart(2, '0')}`,
          blocks: [],
          images: [],
        });
      }
      current = entriesByDate.get(dateKey);
      continue;
    }

    if (!current || !line || /^-{3,}\s*$/.test(line)) continue;

    const imageMatch = line.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    if (imageMatch) {
      const image = { src: imageMatch[1].trim(), alt: current.date };
      current.images.push(image);
      current.blocks.push({ type: 'image', image });
      continue;
    }

    // Preserve the repository's right-aligned attribution paragraphs without accepting arbitrary HTML.
    const alignedMatch = line.match(/^<p\s+align=["']right["']>([\s\S]*)<\/p>$/i);
    if (alignedMatch) {
      current.blocks.push({ type: 'html-text', text: alignedMatch[1] });
      continue;
    }

    current.blocks.push({ type: 'text', text: line });
  }

  return [...entriesByDate.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

function populateMonthFilter() {
  const months = [...new Set(allEntries.map((entry) => entry.monthKey))].sort().reverse();
  monthFilter.replaceChildren();
  monthFilter.add(new Option('全部月份', 'all'));
  months.forEach((month) => {
    const [year, number] = month.split('-');
    monthFilter.add(new Option(`${year}年${Number(number)}月`, month));
  });
}

function filterEntries() {
  const selectedMonth = monthFilter.value || 'all';
  visibleEntries = selectedMonth === 'all'
    ? [...allEntries]
    : allEntries.filter((entry) => entry.monthKey === selectedMonth);
  currentPage = Math.min(currentPage, Math.max(visibleEntries.length - 1, 0));
  renderPage();
}

function renderPage() {
  timeline.replaceChildren();
  if (visibleEntries.length === 0) {
    showMessage('这个月份没有日记内容。');
    pagination.hidden = true;
    pageStatus.textContent = '';
    return;
  }

  const entry = visibleEntries[currentPage];
  const article = document.createElement('article');
  article.className = 'entry';
  article.dataset.date = entry.dateKey;

  const date = document.createElement('h2');
  date.className = 'entry-date';
  date.textContent = entry.date;
  article.append(date);

  const body = document.createElement('div');
  body.className = 'entry-body';
  const imageList = document.createElement('div');
  imageList.className = 'entry-image-list';
  const text = document.createElement('div');
  text.className = 'entry-text';

  entry.blocks.forEach((block) => {
    if (block.type === 'image') {
      const figure = document.createElement('figure');
      figure.className = 'entry-image';
      const image = document.createElement('img');
      image.src = block.image.src;
      image.alt = block.image.alt;
      image.loading = 'lazy';
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', `${entry.date}照片，点击放大`);
      image.addEventListener('click', () => openLightbox(entry, block.image));
      image.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openLightbox(entry, block.image);
        }
      });
      figure.append(image);
      imageList.append(figure);
      return;
    }

    const paragraph = document.createElement('p');
    if (block.type === 'html-text') {
      paragraph.className = 'attribution';
      paragraph.textContent = block.text;
    } else {
      appendInlineMarkdown(paragraph, block.text);
    }
    text.append(paragraph);
  });

  body.append(imageList, text);
  article.append(body);
  timeline.append(article);

  pagination.hidden = false;
  previousButton.disabled = currentPage >= visibleEntries.length - 1;
  nextButton.disabled = currentPage <= 0;
  paginationLabel.textContent = `${currentPage + 1} / ${visibleEntries.length}`;
  pageStatus.textContent = `${entry.date} · ${currentPage + 1} / ${visibleEntries.length} 天`;
}

function appendInlineMarkdown(parent, source) {
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let cursor = 0;
  let match;
  while ((match = linkPattern.exec(source)) !== null) {
    parent.append(document.createTextNode(source.slice(cursor, match.index)));
    const link = document.createElement('a');
    link.href = match[2];
    link.textContent = match[1];
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    parent.append(link);
    cursor = linkPattern.lastIndex;
  }
  parent.append(document.createTextNode(source.slice(cursor)));
}

function changePage(delta) {
  const nextPage = currentPage + delta;
  if (nextPage < 0 || nextPage >= visibleEntries.length) return;
  currentPage = nextPage;
  renderPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openLightbox(entry, selectedImage) {
  lightboxImages = entry.images;
  lightboxIndex = lightboxImages.indexOf(selectedImage);
  updateLightbox();
  if (typeof lightbox.showModal === 'function') {
    lightbox.showModal();
    document.body.classList.add('dialog-open');
  }
}

function updateLightbox() {
  const image = lightboxImages[lightboxIndex];
  if (!image) return;
  lightboxImage.src = image.src;
  lightboxImage.alt = image.alt;
  lightboxCaption.textContent = `${visibleEntries[currentPage].date} · ${lightboxIndex + 1} / ${lightboxImages.length}`;
  const multiple = lightboxImages.length > 1;
  lightboxPrevious.hidden = !multiple;
  lightboxNext.hidden = !multiple;
}

function moveLightbox(delta) {
  if (lightboxImages.length < 2) return;
  lightboxIndex = (lightboxIndex + delta + lightboxImages.length) % lightboxImages.length;
  updateLightbox();
}

function closeLightbox() {
  if (lightbox.open) lightbox.close();
}

function showMessage(message) {
  const paragraph = document.createElement('p');
  paragraph.className = 'empty-state';
  paragraph.textContent = message;
  timeline.replaceChildren(paragraph);
}
