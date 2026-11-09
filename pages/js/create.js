const form = document.querySelector("#compose-form");
const dateInput = document.querySelector("#entry-date");
const textInput = document.querySelector("#entry-text");
const photoInput = document.querySelector("#entry-photo");
const tokenInput = document.querySelector("#write-token");
const photoPreview = document.querySelector("#photo-preview");
const uploadMark = document.querySelector("#upload-mark");
const uploadTitle = document.querySelector("#upload-title");
const uploadDescription = document.querySelector("#upload-description");
const uploadAction = document.querySelector("#upload-action");
const characterCount = document.querySelector("#character-count");
const formMessage = document.querySelector("#form-message");
const submitButton = document.querySelector("#submit-button");
const submitLabel = document.querySelector("#submit-label");

let previewUrl;
let redirecting = false;

function localDateString(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function showMessage(message, kind = "error") {
  formMessage.textContent = message;
  formMessage.dataset.kind = kind;
  formMessage.hidden = false;
}

dateInput.value = localDateString(new Date());

textInput.addEventListener("input", () => {
  characterCount.textContent = String(textInput.value.length);
});

photoInput.addEventListener("change", () => {
  const photo = photoInput.files?.[0];
  if (!photo) {
    return;
  }

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }

  previewUrl = URL.createObjectURL(photo);
  photoPreview.src = previewUrl;
  photoPreview.hidden = false;
  uploadMark.hidden = true;
  uploadTitle.textContent = photo.name;
  uploadDescription.textContent = `${(photo.size / 1024 / 1024).toFixed(2)} MB`;
  uploadAction.textContent = "点击更换照片";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.hidden = true;

  const photo = photoInput.files?.[0];
  if (!photo) {
    showMessage("请先选择一张照片。");
    return;
  }
  if (photo.size > 12 * 1024 * 1024) {
    showMessage("照片大小不能超过 12 MB。");
    return;
  }
  if (!tokenInput.value.trim()) {
    showMessage("请输入 Cloudflare 上设置的日记写入密钥。");
    tokenInput.focus();
    return;
  }

  const formData = new FormData();
  formData.set("date", dateInput.value);
  formData.set("text", textInput.value);
  formData.set("photo", photo, photo.name);

  submitButton.disabled = true;
  submitLabel.textContent = "正在保存…";

  try {
    const response = await fetch("../../api/entries", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenInput.value}`,
      },
      body: formData,
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`服务器返回了无法识别的响应（HTTP ${response.status}）。`);
    }

    if (!response.ok) {
      throw new Error(result.error || `保存失败（HTTP ${response.status}）`);
    }
    if (typeof result.id !== "string" || !result.id) {
      throw new Error("日记已保存，但服务器没有返回日记编号。请返回日记列表确认保存结果。");
    }

    showMessage("保存成功，正在打开刚刚写下的日记。", "success");
    tokenInput.value = "";
    redirecting = true;
    const destination = new URL("../../index.html", window.location.href);
    destination.searchParams.set("entry", result.id);
    window.setTimeout(() => {
      window.location.assign(destination);
    }, 350);
  } catch (error) {
    console.error("保存日记失败：", error);
    showMessage(error.message || "保存日记失败，请检查网络和上传密钥。");
  } finally {
    if (!redirecting) {
      submitButton.disabled = false;
      submitLabel.textContent = "保存这篇日记";
    }
  }
});
