// Barcode scanner for the Food section. Prefers the native BarcodeDetector
// API (Chrome/Android — most UK users); falls back to the ZXing UMD build
// from a CDN for browsers without it (notably iOS Safari). A manual-entry
// input is always offered alongside the camera, since camera scanning can
// fail (permission denied, no camera, poor lighting) and a barcode can
// simply be typed from the packaging instead.
//
// BUG FIX (reported "the barcode tracker doesn't work"): the ZXing path
// previously called `reader.decodeFromVideoElement(video, callback)` — that
// method actually takes ONLY the video element; the callback argument is
// silently discarded, it does a single decode attempt, and rejects with
// NotFoundException on any single frame with no code in it. A blanket
// `.catch(() => {})` swallowed that, so every iPhone user (no
// BarcodeDetector, always on this path) got a live camera preview that could
// never detect anything, with no error shown. Fixed by using
// `decodeFromStream(stream, video, callback)`, the actual continuous-decode
// API, confirmed present with the right arity in the loaded library.
//
// Lookup uses Open Food Facts (free, no API key). Coverage of UK supermarket
// own-brands is good and growing but not complete — a miss returns null and
// the caller falls back to manual food entry with the barcode retained.
import { el, openModal, closeModal } from './ui.js';
import { sb } from './supabase.js';
import { getUid } from './auth.js';

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

// Recently-scanned foods (barcode already known) — one tap logs instantly via
// the existing stored-barcode fast path in js/food.js's scanAndHandle(). No
// migration needed: `foods.barcode` already exists (Round 3).
async function loadRecentScans(limit = 6) {
  try {
    const { data, error } = await sb.from('foods')
      .select('name,barcode,calories').eq('user_id', getUid())
      .not('barcode', 'is', null).order('created_at', { ascending: false }).limit(limit);
    if (error) return [];
    return data || [];
  } catch { return []; }
}

// Opens a scan modal; resolves with the decoded barcode string, or null if
// the user cancels without entering one manually.
export function scanBarcodeModal() {
  return new Promise(resolve => {
    let settled = false;
    let stream = null;
    let stopLoop = false;
    let zxingReader = null;
    let torchOn = false;

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
    const torchBtn = el('button', {
      type: 'button', class: 'btn btn-sm btn-ghost', style: 'margin-top:8px', hidden: true,
      onClick: async () => {
        const track = stream?.getVideoTracks?.()[0];
        if (!track) return;
        torchOn = !torchOn;
        try {
          await track.applyConstraints({ advanced: [{ torch: torchOn }] });
          torchBtn.textContent = torchOn ? '🔦 Torch on' : '🔦 Torch off';
        } catch {
          torchOn = !torchOn; // revert — device rejected it
        }
      }
    }, '🔦 Torch off');
    const recentWrap = el('div', { style: 'margin-top:12px' });
    const manualInput = el('input', { placeholder: 'Or type the barcode', inputmode: 'numeric', style: 'margin-top:14px' });
    const manualBtn = el('button', {
      type: 'button', class: 'btn btn-sm btn-ghost btn-block', style: 'margin-top:8px',
      onClick: () => { const v = manualInput.value.trim(); if (v) finish(v); }
    }, 'Use this barcode');

    openModal(el('div', {}, [
      el('h3', {}, 'Scan barcode'),
      video,
      statusEl,
      torchBtn,
      recentWrap,
      manualInput,
      manualBtn
    ]));

    loadRecentScans().then(recent => {
      if (settled || !recent.length) return;
      recentWrap.append(
        el('div', { class: 'dim', style: 'font-size:11px;text-transform:uppercase;margin-bottom:6px' }, 'Recent scans'),
        el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' }, recent.map(f =>
          el('button', {
            type: 'button', class: 'btn btn-sm btn-ghost',
            onClick: () => finish(f.barcode)
          }, f.name || f.barcode)))
      );
    });

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

      // Torch (flashlight) — only shown when the device/browser actually
      // exposes it (notably absent on iOS Safari; hidden there rather than
      // showing a button that can't do anything).
      try {
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities?.();
        if (caps && 'torch' in caps) torchBtn.hidden = false;
      } catch { /* getCapabilities unsupported — leave torch hidden */ }

      let usedNative = false;
      if ('BarcodeDetector' in window) {
        try {
          const supported = (await window.BarcodeDetector.getSupportedFormats?.()) || ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
          const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter(f => supported.includes(f));
          detectWithNative(formats.length ? formats : ['ean_13']);
          usedNative = true;
        } catch { /* construction failed — fall through to ZXing below */ }
      }
      if (!usedNative) {
        try {
          await loadZXing();
          detectWithZXing();
        } catch (ex) {
          statusEl.textContent = ex.message || 'Scanner unavailable — enter the barcode below.';
        }
      }
    }

    async function detectWithNative(formats) {
      const detector = new window.BarcodeDetector({ formats });
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
      // decodeFromStream fires its callback continuously (once per attempted
      // frame) with (result, error) — act only on a genuine hit, and ignore
      // the constant stream of NotFoundException on empty frames (that's not
      // a scanner failure, just "nothing decodable in this frame").
      zxingReader.decodeFromStream(stream, video, (result, err) => {
        if (stopLoop) return;
        if (result) { finish(result.getText()); return; }
        // Every frame with no code in it fires this callback with a
        // NotFoundException — that's normal, not a failure. Checking
        // `instanceof` rather than `err.name` matters: this minified UMD
        // build renames the error class (confirmed live: err.name === 'N',
        // not 'NotFoundException'), so a name-string check would have
        // misfired "Scanner error" on every ordinary empty frame.
        if (err && !(err instanceof window.ZXing.NotFoundException)) {
          statusEl.textContent = 'Scanner error — enter the barcode below.';
        }
      }).catch(ex => {
        if (!stopLoop) statusEl.textContent = ex?.message || 'Scanner unavailable — enter the barcode below.';
      });
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
