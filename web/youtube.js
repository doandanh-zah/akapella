const local = new URL("http://127.0.0.1:8765/");
const isLocal = location.origin === local.origin;
const form = document.getElementById("youtube-form");
const input = document.getElementById("youtube-url");
const submit = document.getElementById("youtube-submit");
const status = document.getElementById("youtube-status");
const errorText = document.getElementById("youtube-error");
const download = document.getElementById("youtube-download");

if (isLocal) {
  submit.firstChild.textContent = "Tải MP3 ";
  document.getElementById("youtube-help").textContent = "MP3 192 kbps · Video công khai dài tối đa 20 phút.";
  const link = new URLSearchParams(location.hash.slice(1)).get("youtube");
  if (link && link.length <= input.maxLength) {
    input.value = link;
    history.replaceState(null, "", "#youtube");
    form.scrollIntoView();
    input.focus({ preventScroll: true });
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  if (!isLocal) {
    local.hash = new URLSearchParams({ youtube: input.value }).toString();
    location.assign(local.href);
    return;
  }

  submit.disabled = true;
  input.readOnly = true;
  form.setAttribute("aria-busy", "true");
  errorText.hidden = true;
  status.textContent = "Đang lấy âm thanh và chuyển sang MP3…";
  if (!download.hidden) URL.revokeObjectURL(download.href);
  download.hidden = true;
  try {
    const response = await fetch("/api/youtube-mp3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: input.value }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "Không thể tải video. Hãy kiểm tra terminal và thử lại.");
    }
    download.href = URL.createObjectURL(await response.blob());
    download.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "akapella.mp3";
    download.hidden = false;
    download.click();
    status.textContent = "Đã xuất MP3.";
  } catch (error) {
    status.textContent = "";
    errorText.textContent = error.message;
    errorText.hidden = false;
  } finally {
    submit.disabled = false;
    input.readOnly = false;
    form.removeAttribute("aria-busy");
  }
});
