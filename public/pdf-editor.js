import { getDocument, GlobalWorkerOptions } from "/vendor/pdf.mjs";

GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.mjs";

const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;
const fileInput = document.querySelector("#pdf-file-input");
const mergeInput = document.querySelector("#pdf-merge-input");
const pageList = document.querySelector("#pdf-page-list");
const pageCount = document.querySelector("#pdf-page-count");
const stage = document.querySelector("#pdf-stage");
const pageCanvas = document.querySelector("#pdf-canvas");
const annotationCanvas = document.querySelector("#pdf-annotations");
const emptyState = document.querySelector("#pdf-empty");
const status = document.querySelector("#pdf-status");
const promptInput = document.querySelector("#pdf-ai-prompt");
const aiForm = document.querySelector("#pdf-ai-form");
const aiButton = document.querySelector("#pdf-ai-button");
const aiResult = document.querySelector("#pdf-ai-result");
const editorButtons = [...document.querySelectorAll(".pdf-toolbar button")];
const toolButtons = [...document.querySelectorAll("[data-tool]")];

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_PAGES = 300;
const MAX_CONTEXT_CHARS = 36_000;
let pdfDocument = null;
let pdfLibDocument = null;
let pages = [];
let currentIndex = 0;
let activeTool = "";
let pointerStart = null;
let activeAnnotation = null;
let replacementSelection = null;
let sourceName = "document.pdf";
let renderTask = null;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function setEditorEnabled(enabled) {
  editorButtons.forEach((button) => {
    if (button.id !== "pdf-merge-button") button.disabled = !enabled;
  });
  document.querySelector("#pdf-merge-button").disabled = !enabled;
  promptInput.disabled = !enabled;
  aiButton.disabled = !enabled;
  emptyState.hidden = enabled;
  pageCanvas.hidden = !enabled;
  annotationCanvas.hidden = !enabled;
  stage.classList.toggle("has-document", enabled);
}

function validateFile(file) {
  if (!file || !(file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf")) {
    throw new Error("Choose a PDF file.");
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    throw new Error("PDF files must be between 1 byte and 30 MB.");
  }
}

async function loadPdfFile(file) {
  validateFile(file);
  setStatus("Loading PDF...");
  const bytes = await file.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("This file does not contain a valid PDF.");
  }

  const loadedPdf = await PDFDocument.load(bytes, { updateMetadata: false });
  if (loadedPdf.getPageCount() > MAX_PAGES) {
    throw new Error(`PDFs are limited to ${MAX_PAGES} pages.`);
  }
  const loadedViewer = await getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  if (pdfDocument) await pdfDocument.destroy();
  pdfLibDocument = loadedPdf;
  pdfDocument = loadedViewer;
  pages = Array.from({ length: loadedPdf.getPageCount() }, () => ({ annotations: [] }));
  currentIndex = 0;
  sourceName = file.name;
  replacementSelection = null;
  aiResult.hidden = true;
  promptInput.value = "";
  setEditorEnabled(true);
  renderPageList();
  await renderCurrentPage();
  setStatus(`${file.name} · ${pages.length} page${pages.length === 1 ? "" : "s"} · Stored in this browser`);
}

async function reloadViewer() {
  const bytes = await pdfLibDocument.save();
  if (pdfDocument) await pdfDocument.destroy();
  pdfDocument = await getDocument({ data: bytes, isEvalSupported: false }).promise;
}

function renderPageList() {
  pageList.replaceChildren();
  pageCount.textContent = String(pages.length);
  pages.forEach((_, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pdf-page-item";
    button.classList.toggle("selected", index === currentIndex);
    button.setAttribute("aria-current", index === currentIndex ? "page" : "false");
    button.textContent = `Page ${index + 1}`;
    button.addEventListener("click", async () => {
      currentIndex = index;
      replacementSelection = null;
      renderPageList();
      await renderCurrentPage();
    });
    pageList.append(button);
  });

  document.querySelector("#pdf-page-up").disabled = currentIndex <= 0;
  document.querySelector("#pdf-page-down").disabled = currentIndex >= pages.length - 1;
  document.querySelector("#pdf-delete-button").disabled = pages.length <= 1;
}

async function renderCurrentPage() {
  if (!pdfDocument || !pages[currentIndex]) return;
  if (renderTask) {
    renderTask.cancel();
    renderTask = null;
  }

  const page = await pdfDocument.getPage(currentIndex + 1);
  const baseViewport = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(220, document.querySelector(".pdf-stage-wrap").clientWidth - 48);
  const scale = Math.min(1.5, 900 / baseViewport.width, 1100 / baseViewport.height, availableWidth / baseViewport.width);
  const viewport = page.getViewport({ scale });
  const pixelRatio = window.devicePixelRatio || 1;
  pageCanvas.width = Math.ceil(viewport.width * pixelRatio);
  pageCanvas.height = Math.ceil(viewport.height * pixelRatio);
  pageCanvas.style.width = `${viewport.width}px`;
  pageCanvas.style.height = `${viewport.height}px`;
  annotationCanvas.width = pageCanvas.width;
  annotationCanvas.height = pageCanvas.height;
  annotationCanvas.style.width = `${viewport.width}px`;
  annotationCanvas.style.height = `${viewport.height}px`;
  stage.style.width = `${viewport.width}px`;
  stage.style.height = `${viewport.height}px`;

  const context = pageCanvas.getContext("2d", { alpha: false });
  const task = page.render({
    canvasContext: context,
    viewport,
    transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
  });
  renderTask = task;
  try {
    await task.promise;
  } catch (error) {
    if (error.name !== "RenderingCancelledException") throw error;
  } finally {
    if (renderTask === task) renderTask = null;
  }
  drawAnnotations();
  setStatus(`Page ${currentIndex + 1} of ${pages.length}`);
}

function drawAnnotations() {
  const context = annotationCanvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = annotationCanvas.width / ratio;
  const height = annotationCanvas.height / ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  for (const annotation of pages[currentIndex]?.annotations || []) {
    const x = annotation.x * width;
    const y = annotation.y * height;
    const w = annotation.w * width;
    const h = annotation.h * height;
    if (annotation.type === "highlight") {
      context.fillStyle = "rgba(255, 214, 77, 0.42)";
      context.fillRect(x, y, w, h);
    } else if (annotation.type === "whiteout") {
      context.fillStyle = "#ffffff";
      context.fillRect(x, y, w, h);
    } else if (annotation.type === "text") {
      drawPreviewText(context, annotation.text, x, y, w, annotation.fontSize || 16);
    } else if (annotation.type === "draw") {
      context.strokeStyle = "#e64f2e";
      context.lineWidth = Math.max(2, width / 400);
      context.lineCap = "round";
      context.beginPath();
      annotation.points.forEach((point, index) => {
        const pointX = point.x * width;
        const pointY = point.y * height;
        if (index === 0) context.moveTo(pointX, pointY);
        else context.lineTo(pointX, pointY);
      });
      context.stroke();
    }
  }

  if (replacementSelection) {
    const selection = replacementSelection;
    context.strokeStyle = "#f06b43";
    context.setLineDash([5, 4]);
    context.strokeRect(selection.x * width, selection.y * height, selection.w * width, selection.h * height);
    context.setLineDash([]);
  }

  if (activeAnnotation?.type === "highlight") {
    context.fillStyle = "rgba(255, 214, 77, 0.42)";
    context.fillRect(
      activeAnnotation.x * width,
      activeAnnotation.y * height,
      activeAnnotation.w * width,
      activeAnnotation.h * height,
    );
  } else if (activeAnnotation?.type === "draw") {
    context.strokeStyle = "#e64f2e";
    context.lineWidth = Math.max(2, width / 400);
    context.lineCap = "round";
    context.beginPath();
    activeAnnotation.points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x * width, point.y * height);
      else context.lineTo(point.x * width, point.y * height);
    });
    context.stroke();
  } else if (activeAnnotation?.type === "selection") {
    context.fillStyle = "rgba(240, 107, 67, 0.16)";
    context.strokeStyle = "#f06b43";
    context.setLineDash([5, 4]);
    context.fillRect(
      activeAnnotation.x * width,
      activeAnnotation.y * height,
      activeAnnotation.w * width,
      activeAnnotation.h * height,
    );
    context.strokeRect(
      activeAnnotation.x * width,
      activeAnnotation.y * height,
      activeAnnotation.w * width,
      activeAnnotation.h * height,
    );
    context.setLineDash([]);
  }
}

function drawPreviewText(context, text, x, y, width, fontSize) {
  context.fillStyle = "#222";
  context.font = `${fontSize}px Arial, sans-serif`;
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > Math.max(width, 30)) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  lines.forEach((textLine, index) => context.fillText(textLine, x, y + fontSize * (index + 1), width));
}

function getPoint(event) {
  const bounds = annotationCanvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
  };
}

function startTool(tool) {
  activeTool = activeTool === tool ? "" : tool;
  toolButtons.forEach((button) => button.classList.toggle("active", button.dataset.tool === activeTool));
  annotationCanvas.classList.toggle("tool-active", Boolean(activeTool));
  setStatus(
    activeTool === "replace"
      ? "Drag over an area to replace its visible content."
      : activeTool === "highlight"
        ? "Drag over the page to highlight an area."
        : activeTool === "draw"
          ? "Draw on the page with your pointer."
          : activeTool === "text"
            ? "Click on the page to add text."
            : `Page ${currentIndex + 1} of ${pages.length}`,
  );
}

annotationCanvas.addEventListener("pointerdown", (event) => {
  if (!activeTool) return;
  event.preventDefault();
  annotationCanvas.setPointerCapture(event.pointerId);
  const point = getPoint(event);

  if (activeTool === "text") {
    const text = window.prompt("Text to add to the PDF:");
    if (text?.trim()) {
      pages[currentIndex].annotations.push({
        type: "text",
        x: point.x,
        y: point.y,
        w: 0.52,
        h: 0.1,
        text: text.trim(),
        fontSize: 16,
      });
      drawAnnotations();
    }
    return;
  }
  pointerStart = point;
  if (activeTool === "draw") {
    activeAnnotation = { type: "draw", points: [point] };
  } else {
    activeAnnotation = { type: "selection", x: point.x, y: point.y, w: 0, h: 0 };
  }
  drawAnnotations();
});

annotationCanvas.addEventListener("pointermove", (event) => {
  if (!pointerStart || !activeTool) return;
  const point = getPoint(event);
  if (activeTool === "draw") {
    activeAnnotation.points.push(point);
  } else {
    activeAnnotation = {
      type: "selection",
      x: Math.min(pointerStart.x, point.x),
      y: Math.min(pointerStart.y, point.y),
      w: Math.abs(point.x - pointerStart.x),
      h: Math.abs(point.y - pointerStart.y),
    };
  }
  drawAnnotations();
});

annotationCanvas.addEventListener("pointerup", () => {
  if (!pointerStart || !activeTool) return;
  pointerStart = null;
  if (activeTool === "draw" && activeAnnotation.points.length > 1) {
    pages[currentIndex].annotations.push(activeAnnotation);
  } else if (activeTool === "highlight" && activeAnnotation.w > 0.005 && activeAnnotation.h > 0.003) {
    pages[currentIndex].annotations.push({ ...activeAnnotation, type: "highlight" });
  } else if (activeTool === "replace" && activeAnnotation.w > 0.01 && activeAnnotation.h > 0.01) {
    replacementSelection = { ...activeAnnotation };
    setStatus("Area selected. Add replacement text here, or ask Nova to draft it below.");
    const text = window.prompt("Replacement text for the selected area (leave blank to ask Nova):");
    if (text?.trim()) {
      applyTextToSelection(text.trim());
      replacementSelection = null;
    }
  }
  activeAnnotation = null;
  drawAnnotations();
});

function applyTextToSelection(text) {
  if (!replacementSelection) return false;
  const selection = replacementSelection;
  pages[currentIndex].annotations.push(
    { type: "whiteout", x: selection.x, y: selection.y, w: selection.w, h: selection.h },
    {
      type: "text",
      x: selection.x + 0.005,
      y: selection.y + 0.005,
      w: Math.max(0.02, selection.w - 0.01),
      h: Math.max(0.02, selection.h - 0.01),
      text,
      fontSize: Math.max(8, Math.min(16, selection.h * annotationCanvas.clientHeight * 0.6)),
    },
  );
  replacementSelection = null;
  drawAnnotations();
  return true;
}

function annotationsToPdf(pdfPage, annotations, font) {
  const { width, height } = pdfPage.getSize();
  for (const annotation of annotations) {
    const x = annotation.x * width;
    const y = height - (annotation.y + annotation.h) * height;
    const w = annotation.w * width;
    const h = annotation.h * height;
    if (annotation.type === "whiteout") {
      pdfPage.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1) });
    } else if (annotation.type === "highlight") {
      pdfPage.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: rgb(1, 0.84, 0.3),
        opacity: 0.4,
        borderOpacity: 0,
      });
    } else if (annotation.type === "text") {
      const fontSize = annotation.fontSize || 16;
      const lines = wrapPdfText(annotation.text, font, fontSize, Math.max(24, w - 8));
      lines.forEach((line, index) => {
        const lineY = height - annotation.y * height - fontSize * (index + 1) * 1.25;
        if (lineY > 0) pdfPage.drawText(line, { x: annotation.x * width, y: lineY, size: fontSize, font });
      });
    } else if (annotation.type === "draw") {
      for (let index = 1; index < annotation.points.length; index += 1) {
        const from = annotation.points[index - 1];
        const to = annotation.points[index];
        pdfPage.drawLine({
          start: { x: from.x * width, y: height - from.y * height },
          end: { x: to.x * width, y: height - to.y * height },
          thickness: Math.max(2, width / 350),
          color: rgb(0.9, 0.2, 0.1),
        });
      }
    }
  }
}

function wrapPdfText(text, font, fontSize, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function exportPdf() {
  if (!pdfLibDocument) return;
  setStatus("Preparing your edited PDF...");
  const outputDocument = await PDFDocument.load(await pdfLibDocument.save(), { updateMetadata: false });
  const font = await outputDocument.embedFont(StandardFonts.Helvetica);
  outputDocument.getPages().forEach((page, index) => {
    annotationsToPdf(page, pages[index].annotations, font);
  });
  const output = await outputDocument.save();
  const blob = new Blob([output], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const download = document.createElement("a");
  download.href = url;
  download.download = `${sourceName.replace(/\.pdf$/i, "")}-edited.pdf`;
  download.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Edited PDF downloaded.");
}

async function extractDocumentText() {
  const chunks = [];
  let remaining = MAX_CONTEXT_CHARS;
  for (let index = 0; index < pdfDocument.numPages && remaining > 0; index += 1) {
    const page = await pdfDocument.getPage(index + 1);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").trim();
    if (pageText) {
      const chunk = `Page ${index + 1}:\n${pageText}`.slice(0, remaining);
      chunks.push(chunk);
      remaining -= chunk.length;
    }
  }
  if (!chunks.length) {
    throw new Error("No selectable text was found. This may be a scanned PDF; use OCR before asking Nova about its text.");
  }
  return { text: chunks.join("\n\n"), truncated: remaining <= 0 };
}

async function askNova(prompt) {
  if (!pdfDocument) throw new Error("Open a PDF first.");
  const { text, truncated } = await extractDocumentText();
  const selectionHint = replacementSelection
    ? "The user selected a page region to replace. Draft concise replacement text for that area."
    : "Answer the user's question or provide concise text they can add to the current page.";
  const message = [
    "You are helping the user review and edit a PDF. Use only the document content below as source material. If asked for an edit, return the revised text clearly and do not claim you changed the file.",
    selectionHint,
    truncated ? "Note: the document text was truncated to fit; later pages may be omitted." : "",
    `User request: ${prompt}`,
    `Document text:\n${text}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: message }] }),
  });
  const result = await response.json();
  if (response.status === 401) window.dispatchEvent(new Event("nova:session-expired"));
  if (!response.ok) throw new Error(result.error || "Nova could not answer the PDF request.");
  return result.reply;
}

async function clearPdfDocument() {
  if (pdfDocument) await pdfDocument.destroy();
  pdfDocument = null;
  pdfLibDocument = null;
  pages = [];
  currentIndex = 0;
  activeTool = "";
  activeAnnotation = null;
  replacementSelection = null;
  pageList.replaceChildren();
  pageCount.textContent = "0";
  pageCanvas.width = 0;
  pageCanvas.height = 0;
  annotationCanvas.width = 0;
  annotationCanvas.height = 0;
  stage.style.width = "";
  stage.style.height = "";
  renderPageList();
  setEditorEnabled(false);
  aiResult.hidden = true;
  promptInput.value = "";
  setStatus("Open a PDF to begin. Your file stays in this browser.");
}

window.addEventListener("nova:logout", () => {
  clearPdfDocument().catch((error) => setStatus(error.message || "Could not clear the PDF workspace.", true));
});

function showAiResult(reply) {
  aiResult.replaceChildren();
  const text = document.createElement("p");
  text.className = "pdf-ai-answer";
  text.textContent = reply;
  aiResult.append(text);

  const actions = document.createElement("div");
  actions.className = "pdf-ai-actions";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "pdf-tool-button";
  addButton.textContent = replacementSelection ? "Replace selected area" : "Add to current page";
  addButton.addEventListener("click", () => {
    if (replacementSelection) {
      applyTextToSelection(reply);
    } else {
      pages[currentIndex].annotations.push({
        type: "text",
        x: 0.12,
        y: 0.12,
        w: 0.76,
        h: 0.3,
        text: reply,
        fontSize: 14,
      });
      drawAnnotations();
    }
    aiResult.hidden = true;
    setStatus("Nova's text was added as an editable overlay. Download the PDF to save your changes.");
  });
  actions.append(addButton);
  aiResult.append(actions);
  aiResult.hidden = false;
}

fileInput.addEventListener("change", async () => {
  try {
    if (fileInput.files[0]) await loadPdfFile(fileInput.files[0]);
  } catch (error) {
    setStatus(error.message || "Could not open this PDF.", true);
  } finally {
    fileInput.value = "";
  }
});

mergeInput.addEventListener("change", async () => {
  try {
    const file = mergeInput.files[0];
    if (!file || !pdfLibDocument) return;
    validateFile(file);
    const incoming = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
    if (pdfLibDocument.getPageCount() + incoming.getPageCount() > MAX_PAGES) {
      throw new Error(`Merged PDFs are limited to ${MAX_PAGES} pages.`);
    }
    setStatus("Merging PDF pages...");
    const copiedPages = await pdfLibDocument.copyPages(incoming, incoming.getPageIndices());
    copiedPages.forEach((page) => {
      pdfLibDocument.addPage(page);
      pages.push({ annotations: [] });
    });
    await reloadViewer();
    currentIndex = pages.length - copiedPages.length;
    renderPageList();
    await renderCurrentPage();
    setStatus(`Added ${copiedPages.length} page${copiedPages.length === 1 ? "" : "s"} from ${file.name}.`);
  } catch (error) {
    setStatus(error.message || "Could not merge this PDF.", true);
  } finally {
    mergeInput.value = "";
  }
});

toolButtons.forEach((button) => button.addEventListener("click", () => startTool(button.dataset.tool)));

document.querySelector("#pdf-rotate-button").addEventListener("click", async () => {
  const pdfPage = pdfLibDocument.getPage(currentIndex);
  pdfPage.setRotation(degrees((pdfPage.getRotation().angle + 90) % 360));
  await reloadViewer();
  await renderCurrentPage();
});

document.querySelector("#pdf-delete-button").addEventListener("click", async () => {
  if (pages.length <= 1) return;
  pdfLibDocument.removePage(currentIndex);
  pages.splice(currentIndex, 1);
  currentIndex = Math.min(currentIndex, pages.length - 1);
  await reloadViewer();
  renderPageList();
  await renderCurrentPage();
});

async function moveCurrentPage(direction) {
  const target = currentIndex + direction;
  if (target < 0 || target >= pages.length) return;
  const page = pdfLibDocument.getPage(currentIndex);
  pdfLibDocument.removePage(currentIndex);
  pdfLibDocument.insertPage(target, page);
  [pages[currentIndex], pages[target]] = [pages[target], pages[currentIndex]];
  currentIndex = target;
  await reloadViewer();
  renderPageList();
  await renderCurrentPage();
}

document.querySelector("#pdf-page-up").addEventListener("click", () => moveCurrentPage(-1));
document.querySelector("#pdf-page-down").addEventListener("click", () => moveCurrentPage(1));
document.querySelector("#pdf-merge-button").addEventListener("click", () => mergeInput.click());
document.querySelector("#pdf-export-button").addEventListener("click", () => {
  exportPdf().catch((error) => setStatus(error.message || "Could not export this PDF.", true));
});

aiForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt || aiButton.disabled) return;
  aiButton.disabled = true;
  aiButton.textContent = "Nova is reading...";
  aiResult.hidden = true;
  setStatus("Extracting document text and asking Nova...");
  try {
    const reply = await askNova(prompt);
    showAiResult(reply);
    setStatus("Nova replied. Review the response, then add it to the PDF if you want.");
  } catch (error) {
    setStatus(error.message || "Could not complete the PDF request.", true);
  } finally {
    aiButton.disabled = false;
    aiButton.textContent = "Ask Nova";
  }
});

window.addEventListener("resize", () => {
  if (pdfDocument) renderCurrentPage().catch((error) => setStatus(error.message, true));
});
