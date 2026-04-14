// Client-side image cropper + upload to Cloudinary via API endpoint
(function(){
  const UPLOAD_URL = window.ADMIN_IMAGE_UPLOAD_URL || '/api/admin/upload-image';
  let currentInput = null;
  let cropper = null;

  function showModal(dataUrl, inputEl) {
    const modal = document.getElementById('image-cropper-modal');
    const img = document.getElementById('cropper-image');
    const status = document.getElementById('cropper-status');
    img.src = dataUrl;
    modal.style.display = 'flex';
    status.textContent = '準備裁切';
    if (cropper) { cropper.destroy(); cropper = null; }
    cropper = new Cropper(img, { viewMode: 1, movable: true, zoomable: true, aspectRatio: NaN });
    currentInput = inputEl;
  }

  function hideModal() {
    const modal = document.getElementById('image-cropper-modal');
    modal.style.display = 'none';
    if (cropper) { cropper.destroy(); cropper = null; }
    currentInput = null;
  }

  async function uploadCropped() {
    const w = parseInt(document.getElementById('cropper-width').value,10) || 400;
    const h = parseInt(document.getElementById('cropper-height').value,10) || 400;
    const mime = document.getElementById('cropper-format').value || 'image/jpeg';
    const status = document.getElementById('cropper-status');
    status.textContent = '產生檔案...';
    const canvas = cropper.getCroppedCanvas({ width: w, height: h, imageSmoothingQuality: 'high' });
    if (!canvas) { status.textContent = '取得裁切影像失敗'; return; }

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) { status.textContent = '轉換 Blob 失敗'; reject(new Error('no blob')); return; }
        status.textContent = '準備傳回 input...';
        try {
          // create a File and place it into the original input.files so existing handlers will upload it
          const name = (currentInput && currentInput.files && currentInput.files[0] && currentInput.files[0].name) || 'cropped.jpg';
          const file = new File([blob], name, { type: mime });
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          currentInput.files = dataTransfer.files;
          // dispatch native change so existing upload handlers run
          const ev = new Event('change', { bubbles: true });
          currentInput.dispatchEvent(ev);
          status.textContent = '已放回 input，等待上傳';
          setTimeout(hideModal, 500);
          resolve({ ok: true });
        } catch (err) {
          status.textContent = '操作失敗';
          console.error('set input files error', err);
          reject(err);
        }
      }, mime, 0.9);
    });
  }

  function onFileChange(e) {
    const input = e.target;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => showModal(reader.result, input);
    reader.readAsDataURL(file);
  }

  function attachToAll() {
    const inputs = Array.from(document.querySelectorAll('input[type=file]'));
    inputs.forEach(inp => {
      // avoid double-binding
      if (inp.dataset.cropbound === '1') return;
      inp.addEventListener('change', onFileChange);
      inp.dataset.cropbound = '1';
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    attachToAll();
    // reattach when dynamic sections load (simple polling)
    setInterval(attachToAll, 3000);

    document.getElementById('cropper-cancel').addEventListener('click', hideModal);
    document.getElementById('cropper-confirm').addEventListener('click', () => {
      uploadCropped().catch(()=>{});
    });
  });

})();
