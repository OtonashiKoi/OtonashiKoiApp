// Client-side image cropper + upload to Cloudinary via API endpoint
(function(){
  const UPLOAD_URL = window.ADMIN_IMAGE_UPLOAD_URL || '/api/admin/upload-image';
  let currentInput = null;
  let cropper = null;
  let sourceHasAlpha = false; // 來源圖是否含透明（去背立繪）→ 匯出不可用 JPEG

  function detectAlpha(dataUrl) {
    sourceHasAlpha = false;
    try {
      const probe = new Image();
      probe.onload = () => {
        try {
          const s = 64, c = document.createElement('canvas'); c.width = s; c.height = s;
          const cx = c.getContext('2d'); cx.clearRect(0, 0, s, s); cx.drawImage(probe, 0, 0, s, s);
          const d = cx.getImageData(0, 0, s, s).data;
          for (let i = 3; i < d.length; i += 4) { if (d[i] < 250) { sourceHasAlpha = true; break; } }
        } catch (_) { /* 跨域等讀不到就當無透明 */ }
      };
      probe.src = dataUrl;
    } catch (_) { /* noop */ }
  }

  function shouldSkipCropper(input) {
    if (!input) return true;
    const skipIds = new Set(['items-img-input', 'items-csv-input']);
    return skipIds.has(input.id) || input.dataset.noCropper === '1';
  }

  function showModal(dataUrl, inputEl) {
    const modal = document.getElementById('image-cropper-modal');
    const img = document.getElementById('cropper-image');
    const status = document.getElementById('cropper-status');
    img.src = dataUrl;
    detectAlpha(dataUrl);
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

  // 大圖用途（劇情背景/CG/立繪/表情）：不縮到 400x400，改用裁切區原始解析度（避免模糊），上限 2560。
  function isHiResTarget(input) {
    if (!input) return false;
    if (input.id === 'story-f-bg' || input.id === 'npc-form-portrait') return true;
    // data-npc-portrait＝現有 NPC 的🖼立繪上傳(編輯既有角色)；漏掉會被縮成 400x400 → 立繪變糊。立繪/背景/CG/表情一律保留高解析。
    if (input.hasAttribute && (input.hasAttribute('data-node-bg') || input.hasAttribute('data-node-cg') || input.hasAttribute('data-expr-file') || input.hasAttribute('data-npc-portrait'))) return true;
    return false;
  }

  async function uploadCropped() {
    const w = parseInt(document.getElementById('cropper-width').value,10) || 400;
    const h = parseInt(document.getElementById('cropper-height').value,10) || 400;
    let mime = document.getElementById('cropper-format').value || 'image/jpeg';
    // 去背立繪：JPEG 不支援透明會被填黑 → 自動改用 PNG 保留透明
    if (sourceHasAlpha && mime === 'image/jpeg') mime = 'image/png';
    const status = document.getElementById('cropper-status');
    status.textContent = '產生檔案...';
    // 劇情背景/CG/立繪：保留原始解析度（只限最大邊 2560）；其餘沿用寬高欄位
    const canvas = isHiResTarget(currentInput)
      ? cropper.getCroppedCanvas({ maxWidth: 2560, maxHeight: 2560, imageSmoothingQuality: 'high', fillColor: 'transparent' })
      : cropper.getCroppedCanvas({ width: w, height: h, imageSmoothingQuality: 'high', fillColor: 'transparent' });
    if (!canvas) { status.textContent = '取得裁切影像失敗'; return; }

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) { status.textContent = '轉換 Blob 失敗'; reject(new Error('no blob')); return; }
        status.textContent = '準備傳回 input...';
        try {
          // create a File and place it into the original input.files so existing handlers will upload it
          const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
          const baseName = (currentInput && currentInput.files && currentInput.files[0] && currentInput.files[0].name || 'cropped').replace(/\.[^.]+$/, '');
          const name = `${baseName}.${ext}`;
          const file = new File([blob], name, { type: mime });
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          currentInput.files = dataTransfer.files;
          // mark as cropped so upload handlers can detect final dispatch
          currentInput.dataset.cropped = '1';
          // dispatch native change so existing upload handlers run
          const ev = new Event('change', { bubbles: true });
          currentInput.dispatchEvent(ev);
          setTimeout(() => {
            if (currentInput && currentInput.dataset.cropped === '1') {
              delete currentInput.dataset.cropped;
            }
          }, 0);
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
    if (shouldSkipCropper(input)) return;              // 跳過的 input：交給頁面原本 handler
    if (input.dataset.cropped === '1') {               // 裁切後回填的那一次：放行，讓上傳 handler 跑
      delete input.dataset.cropped;
      return;
    }
    const file = input.files[0];
    if (!file.type.startsWith('image/')) return;       // 非圖片：不攔
    // 到這裡＝使用者剛選圖（尚未裁切）。攔下這次 change，先開裁切視窗；
    // 不能讓頁面自己的上傳 handler 這時把「原圖」傳上去（否則會多傳一次未裁切的）。
    e.stopImmediatePropagation();
    const reader = new FileReader();
    reader.onload = () => showModal(reader.result, input);
    reader.readAsDataURL(file);
  }

  function attachToAll() {
    const inputs = Array.from(document.querySelectorAll('input[type=file]'));
    inputs.forEach(inp => {
      // avoid double-binding
      if (inp.dataset.cropbound === '1') return;
      // 用「捕獲階段」綁定：搶在頁面自己的 change handler(冒泡階段)之前攔截，
      // 才能在未裁切時擋掉原圖上傳；裁切後回填的那次不擋、正常放行。
      inp.addEventListener('change', onFileChange, true);
      inp.dataset.cropbound = '1';
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    attachToAll();
    // reattach when dynamic sections load (simple polling)
    setInterval(attachToAll, 3000);

    const cancelBtn = document.getElementById('cropper-cancel');
    const confirmBtn = document.getElementById('cropper-confirm');
    if (cancelBtn && cancelBtn.dataset.cropperBound !== '1') {
      cancelBtn.addEventListener('click', hideModal);
      cancelBtn.dataset.cropperBound = '1';
    }
    if (confirmBtn && confirmBtn.dataset.cropperBound !== '1') {
      confirmBtn.addEventListener('click', () => {
        uploadCropped().catch(()=>{});
      });
      confirmBtn.dataset.cropperBound = '1';
    }
  });

})();
