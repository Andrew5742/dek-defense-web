const params = new URLSearchParams(location.search);
const encodedFile = params.get('file');
const filePath = encodedFile ? decodeURIComponent(encodedFile) : '';
const canvas = document.getElementById('pdfCanvas');
const ctx = canvas.getContext('2d');
const counter = document.getElementById('counter');
let pdfDoc = null;
let pageNum = 1;
let rendering = false;

async function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function initPdf() {
  await loadScript('../../node_modules/pdfjs-dist/build/pdf.mjs');
}

async function loadPdf() {
  const pdfjsLib = globalThis.pdfjsLib || window.pdfjsLib;
  if (!pdfjsLib) throw new Error('pdf.js не завантажено');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '../../node_modules/pdfjs-dist/build/pdf.worker.mjs';
  const url = `file://${filePath.replace(/\\/g, '/')}`;
  pdfDoc = await pdfjsLib.getDocument(url).promise;
  await renderPage(1);
}

async function renderPage(num) {
  if (!pdfDoc || rendering) return;
  rendering = true;
  pageNum = Math.max(1, Math.min(num, pdfDoc.numPages));
  const page = await pdfDoc.getPage(pageNum);
  const viewportBase = page.getViewport({ scale: 1 });
  const scale = Math.min(window.innerWidth / viewportBase.width, window.innerHeight / viewportBase.height) * 0.96;
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  counter.textContent = `${pageNum} / ${pdfDoc.numPages}`;
  rendering = false;
}

function next() { if (pdfDoc && pageNum < pdfDoc.numPages) renderPage(pageNum + 1); }
function prev() { if (pdfDoc && pageNum > 1) renderPage(pageNum - 1); }

document.body.addEventListener('click', (e) => {
  if (e.target.closest('.pdf-unlock')) return;
  next();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ') next();
  if (e.key === 'ArrowLeft') prev();
});
window.addEventListener('resize', () => renderPage(pageNum));
document.getElementById('exitBtn').addEventListener('click', async () => {
  const password = document.getElementById('passwordInput').value;
  try { await window.dekAgent.closePresentation(password); } catch (e) { alert(e.message); }
});

initPdf().then(loadPdf).catch((error) => {
  document.body.innerHTML = `<div class="error-screen"><h1>Не вдалося відкрити PDF</h1><p>${error.message}</p></div>`;
});
