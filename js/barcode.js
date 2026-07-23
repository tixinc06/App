// Barcode scanner for the Food section. Prefers the native BarcodeDetector
// API (Chrome/Android — most UK users); falls back to the ZXing UMD build
// from a CDN for browsers without it (notably iOS Safari). A manual-entry
// input is always offered alongside the camera, since camera scanning can
// fail (permission denied, no camera, poor lighting) and a barcode can
// simply be typed from the packaging instead.
//
// Lookup uses Open Food Facts (free, no API key). Coverage of UK supermarket
// own-brands is good and growing but not complete — a miss returns null and
// the caller falls back to manual food entry with the barcode retained.
import { el, openModal, closeModal } from './ui.js';

const ZXING_CDN = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
let zxingLoadPromise = null;
function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingLoadPromise) {
    zxingLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = ZXING_CDN;
      s.onload = () => resolve(window.ZXing);
      s.onerror = () => reject(new Error('Could not load the scanner library.'));
      document.head.appendChild(s);
    });
  }
  return zxingLoadPromise;
}

// Opens a scan modal; resolves with the decoded barcode string, or null if
// the user cancels without entering one manually.
export function scanBarcodeModal() {
  return new Promise(resolve => {
    let settled = false;
    let stream = null;
    let stopLoop = false;
    let zxingReader = null;

    function finish(value) {
      if (settled) return;
      settled = true;
      stopLoop = true;
      observer.disconnect();
      if (zxingReader) { try { zxingReader.reset(); } catch { /* already stopped */ } }
      if (stream) stream.getTracks().forEach(t => t.stop());
      closeModal();
      resolve(value);
    }

    const video = el('video', {
      autoplay: true, playsinline: true, muted: true,
      style: 'width:100%;border-radius:12px;background:#000;max-height:280px;object-fit:cover'
    });
    const statusEl = el('div', { class: 'dim', style: 'font-size:12px;margin-top:8px;text-align:center' }, 'Point the camera at a barcode…');
    const manualInput = el('input', { placeholder: 'Or type the barcode', inputmode: 'numeric', style: 'margin-top:14px' });
    const manualBtn = el('button', {
      type: 'button', class: 'btn btn-sm btn-ghost btn-block', style: 'margin-top:8px',
      onClick: () => { const v = manualInput.value.trim(); if (v) finish(v); }
    }, 'Use this barcode');

    openModal(el('div', {}, [
      el('h3', {}, 'Scan barcode'),
      video,
      statusEl,
      manualInput,
      manualBtn
    ]));

    // Catches the user closing the modal via ✕/backdrop — treated as cancel.
    const host = document.getElementById('modal-host');
    const observer = new MutationObserver(() => { if (host.hidden) finish(null); });
    observer.observe(host, { attributes: true, attributeFilter: ['hidden'] });

    startCamera();

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        await video.play().catch(() => {});
      } catch {
        statusEl.textContent = 'Camera unavailable — enter the barcode below.';
        return;
      }

      if ('BarcodeDetector' in window) {
        detectWithNative();
      } else {
        try {
          await loadZXing();
          detectWithZXing();
        } catch {
          statusEl.textContent = 'Scanner unavailable — enter the barcode below.';
        }
      }
    }

    async function detectWithNative() {
      const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const loop = async () => {
        if (stopLoop) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) { finish(codes[0].rawValue); return; }
        } catch { /* keep trying — a failed single frame isn't fatal */ }
        requestAnimationFrame(loop);
      };
      loop();
    }

    function detectWithZXing() {
      zxingReader = new window.ZXing.BrowserMultiFormatReader();
      zxingReader.decodeFromVideoElement(video, (result) => {
        if (stopLoop) return;
        if (result) finish(result.getText());
      }).catch(() => { /* stream/reset noise — ignore */ });
    }
  });
}

// Open Food Facts lookup. Returns a food-shaped object on a hit, or null on
// a miss/network error (both treated the same by the caller — fall back to
// manual entry with the barcode kept).
export async function lookupBarcode(barcode) {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands,nutriments,serving_size`
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== 1 || !json.product) return null;
    const n = json.product.nutriments || {};
    const name = [json.product.product_name, json.product.brands].filter(Boolean).join(' — ') || 'Scanned item';
    return {
      name,
      serving_desc: json.product.serving_size || '100g',
      calories: Math.round(n['energy-kcal_100g'] || 0),
      protein: Number(n.proteins_100g) || 0,
      carbs: Number(n.carbohydrates_100g) || 0,
      fat: Number(n.fat_100g) || 0,
      barcode
    };
  } catch {
    return null;
  }
}
