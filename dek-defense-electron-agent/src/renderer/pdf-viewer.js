const params = new URLSearchParams(location.search);
const encodedFile = params.get('file');
const filePath = encodedFile ? decodeURIComponent(encodedFile) : '';
const canvas = document.getElementById('pdfCanvas');
const ctx = canvas.getContext('2d');
const counter = document.getElementById('counter');
let pdfDoc = null;
let pageNum = 1;
let rendering = false;

function filePathToUrl(value) {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  return encodeURI(`file:///${normalized}`);
}

async function loadPdfRuntime() {
  const pdfjsLib = await import('../../node_modules/pdfjs-dist/build/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '../../node_modules/pdfjs-dist/build/pdf.worker.mjs';
  return pdfjsLib;
}

async function loadPdf() {
  if (!filePath) throw new Error('Файл PDF не передано');
  const pdfjsLib = await loadPdfRuntime();
  pdfDoc = await pdfjsLib.getDocument(filePathToUrl(filePath)).promise;
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

function next() { if (pdfDoc && pageNum < pdfDoc.numPages) void renderPage(pageNum + 1); }
function prev() { if (pdfDoc && pageNum > 1) void renderPage(pageNum - 1); }

document.body.addEventListener('click', (event) => {
  if (event.target.closest('.pdf-unlock')) return;
  next();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight' || event.key === ' ') next();
  if (event.key === 'ArrowLeft') prev();
});
window.addEventListener('resize', () => void renderPage(pageNum));
document.getElementById('exitBtn').addEventListener('click', async () => {
  const password = document.getElementById('passwordInput').value;
  try { await window.dekAgent.closePresentation(password); } catch (error) { alert(error.message); }
});

loadPdf().catch((error) => {
  document.body.innerHTML = `<div class="error-screen"><h1>Не вдалося відкрити PDF</h1><p>${error.message}</p></div>`;
});
