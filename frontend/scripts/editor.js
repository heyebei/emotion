const dateInput = document.getElementById('entry-date');
const textInput = document.getElementById('entry-text');
const imageInput = document.getElementById('image-input');
const fileList = document.getElementById('file-list');
const previewOutput = document.getElementById('markdown-output');
const statusEl = document.getElementById('status');
const form = document.getElementById('diary-form');

const today = new Date();
dateInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
renderPreview();

imageInput.addEventListener('change', () => {
  const files = Array.from(imageInput.files || []);
  fileList.textContent = files.length ? `已选择 ${files.length} 张图片：${files.map((file) => file.name).join(', ')}` : '未选择图片';
  renderPreview();
});
textInput.addEventListener('input', renderPreview);
dateInput.addEventListener('change', renderPreview);
document.getElementById('preview-btn').addEventListener('click', () => {
  renderPreview();
  statusEl.textContent = '预览已更新。';
});
document.getElementById('back-btn').addEventListener('click', () => { window.location.href = './index.html'; });
document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('../../api/auth/logout', { method: 'POST' });
  window.location.assign('./login.html');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const files = Array.from(imageInput.files || []);
  const date = dateInput.value;
  const content = textInput.value.trim();
  if (!date || !content || !files.length) {
    statusEl.textContent = '请填写日期、内容，并至少上传一张照片。';
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  statusEl.textContent = '正在保存中…';
  const formData = new FormData();
  formData.append('date', date);
  formData.append('content', content);
  files.forEach((file) => formData.append('images', file));

  try {
    const response = await fetch('../../api/diary', { method: 'POST', body: formData });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.assign('./login.html');
      return;
    }
    if (!response.ok) throw new Error(result.error || '保存失败');
    statusEl.textContent = `保存成功：${result.images.join(', ')}`;
    previewOutput.textContent = result.markdown;
  } catch (error) {
    statusEl.textContent = error.message || '保存失败，请重试。';
  } finally {
    submitButton.disabled = false;
  }
});

function renderPreview() {
  const date = dateInput.value;
  const content = textInput.value.trim();
  const files = Array.from(imageInput.files || []);
  if (!date || !content || !files.length) {
    previewOutput.textContent = '请输入日期和内容，并至少上传一张照片。';
    return;
  }
  const imageMarkdown = files.map((file, index) => `![image](image/${buildImageName(date, index + 1, file.name)})`);
  previewOutput.textContent = [`--${toChineseDate(date)}`, '', content, '', imageMarkdown.join('\n'), '', '----', ''].join('\n');
}

function buildImageName(dateValue, index, originalName) {
  const [year, month, day] = dateValue.split('-');
  return `${year}${month}${day}${String(index).padStart(2, '0')}${getExtension(originalName)}`;
}
function toChineseDate(dateValue) {
  const [year, month, day] = dateValue.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}
function getExtension(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return '.png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return '.jpg';
  if (lower.endsWith('.webp')) return '.webp';
  if (lower.endsWith('.gif')) return '.gif';
  return '.jpg';
}
