// ML Genie front end.
// 1. Choosing or dropping a CSV uploads it straight away to /generate_dropdown.
// 2. Only after a successful upload is the target-column form shown.
// 3. Submitting that form posts to /set_target_column, which re-renders the page
//    with the insights and generated code (those sections only exist in that response).

const MAX_FILE_MB = 20;

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const fileName = document.getElementById("file-name");
const uploadStatus = document.getElementById("upload-status");
const targetForm = document.getElementById("target-form");
const targetSelect = document.getElementById("targetColumnDropdown");
const taskHint = document.getElementById("task-hint");
const runButton = document.getElementById("run-button");
const spinner = document.getElementById("loading-spinner");

/* ---------- helpers ---------- */

function setStatus(message, kind = "") {
    uploadStatus.textContent = message;
    uploadStatus.className = "status" + (kind ? " is-" + kind : "");
}

function scrollToId(id) {
    const target = document.getElementById(id);
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

document.querySelectorAll("[data-scroll-to]").forEach((el) => {
    el.addEventListener("click", (e) => {
        e.preventDefault();
        scrollToId(el.dataset.scrollTo);
    });
});

/* ---------- 1. choosing and dropping a file ---------- */

fileInput.addEventListener("change", () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
});

// dragenter/dragleave fire for every child element, so count them to know
// when the pointer has really left the drop zone
let dragDepth = 0;

dropZone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth += 1;
    dropZone.classList.add("is-over");
});

dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
});

dropZone.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropZone.classList.remove("is-over");
});

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove("is-over");
    const files = e.dataTransfer.files;
    if (files.length > 1) {
        setStatus("Drop one file at a time.", "error");
        return;
    }
    if (files.length) handleFile(files[0]);
});

// A file dropped just outside the drop zone would otherwise make the browser open it
// and leave the app
["dragover", "drop"].forEach((type) =>
    window.addEventListener(type, (e) => {
        if (!dropZone.contains(e.target)) e.preventDefault();
    }));

function handleFile(file) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
        setStatus(`${file.name} isn't a CSV file. Choose a file ending in .csv.`, "error");
        return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
        setStatus(`${file.name} is larger than ${MAX_FILE_MB} MB. Choose a smaller file.`, "error");
        return;
    }
    if (file.size === 0) {
        setStatus(`${file.name} is empty.`, "error");
        return;
    }
    fileName.textContent = file.name;
    fileName.hidden = false;
    dropZone.classList.add("has-file");
    upload(file);
}

/* ---------- 2. uploading, then showing the target column ---------- */

async function upload(file) {
    hideTargetForm();
    dropZone.classList.add("is-busy");
    dropZone.setAttribute("aria-busy", "true");
    setStatus(`Uploading ${file.name}…`);

    const body = new FormData();
    body.append("file", file);

    try {
        const response = await fetch("/generate_dropdown", {
            method: "POST",
            body,
            headers: { "ngrok-skip-browser-warning": "1" },
        });
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error("The server couldn't read that file. Check that it's a valid CSV.");
        }
        if (!response.ok || !Array.isArray(data.column_names)) {
            throw new Error(data.error || "The upload didn't work. Try again.");
        }
        // the server appends "None" for clustering; the form adds its own clearer option for that
        const columns = data.column_names.filter((c) => c !== "None");
        if (columns.length < 2) {
            throw new Error("The CSV needs at least two columns.");
        }
        showTargetForm(columns);
        setStatus(`${file.name} uploaded: ${columns.length} columns found.`, "success");
    } catch (err) {
        // fetch throws a TypeError when the server can't be reached at all
        const message = err.name === "TypeError"
            ? "Couldn't reach the server. Check that the app is still running, then try again."
            : err.message;
        setStatus(message, "error");
        dropZone.classList.remove("has-file");
    } finally {
        dropZone.classList.remove("is-busy");
        dropZone.removeAttribute("aria-busy");
        fileInput.value = ""; // lets the same file be chosen again after a fix
    }
}

function makeOption(label, value) {
    const option = document.createElement("option");
    option.textContent = label;   // textContent, so a column name can never inject HTML
    option.value = value;
    return option;
}

function showTargetForm(columns) {
    const placeholder = makeOption("Choose a column", "");
    placeholder.disabled = true;
    placeholder.selected = true;
    targetSelect.replaceChildren(placeholder);
    columns.forEach((name) => targetSelect.append(makeOption(name, name)));
    targetSelect.append(makeOption("None: group similar rows (clustering)", "None"));

    taskHint.textContent = "";
    runButton.disabled = true;
    targetForm.hidden = false;
    targetSelect.focus({ preventScroll: true });
    targetForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideTargetForm() {
    targetForm.hidden = true;
    runButton.disabled = true;
}

targetSelect.addEventListener("change", () => {
    const value = targetSelect.value;
    taskHint.textContent = value === "None"
        ? "No target: ML Genie will group similar rows into clusters."
        : `ML Genie will train models to predict ${value}.`;
    runButton.disabled = !value;
});

targetForm.addEventListener("submit", (e) => {
    if (!targetSelect.value) {
        e.preventDefault();
        return;
    }
    // normal form post: the server responds with the page including the results
    runButton.disabled = true;
    runButton.textContent = "Analysing…";
    spinner.hidden = false;
});

// Coming back with the browser's Back button restores the page from cache with the
// spinner still showing; reset it
window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
        spinner.hidden = true;
        runButton.textContent = "Run analysis";
        runButton.disabled = !targetSelect.value;
    }
});

/* ---------- 3. results ---------- */

// an analysis error re-renders the page with a message in the upload panel: show it
if (document.getElementById("analysis-error")) {
    window.addEventListener("load", () => scrollToId("upload"));
}

const results = document.getElementById("results");
if (results) {
    // the page was just re-rendered with an analysis: take the user straight to it
    window.addEventListener("load", () => scrollToId("results"));
}

const copyButton = document.getElementById("copy-button");
if (copyButton) {
    copyButton.addEventListener("click", async () => {
        const code = document.getElementById("generated-code").textContent;
        try {
            await navigator.clipboard.writeText(code);
            copyButton.textContent = "Copied";
        } catch {
            copyButton.textContent = "Select and copy manually";
        }
        setTimeout(() => { copyButton.textContent = "Copy code"; }, 2000);
    });
}
