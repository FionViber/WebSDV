const bootLoadingTitle = document.getElementById("loading-title");
const bootLoadingDetail = document.getElementById("loading-detail");
const gameScript = document.querySelector('script[type="module"][src]');

function showGameScriptFailure(event) {
	if (window.__sdvLoaderStarted) return;
	const scriptUrl = event?.target?.src || event?.filename || gameScript?.src || "game.js";
	bootLoadingTitle.textContent = "Game script failed to load";
	bootLoadingDetail.textContent = `${scriptUrl} · Confirm the file returns HTTP 200 with a JavaScript MIME type, then reload.`;
}

window.__sdvLoaderStarted = false;
const openedFromFile = window.location.protocol === "file:";

if (openedFromFile) {
	bootLoadingTitle.textContent = "Open the game over HTTP or HTTPS";
	bootLoadingDetail.textContent = "Browsers block game scripts and assets opened from file://. Serve this folder locally or publish it to GitHub Pages or Cloudflare Pages.";
} else {
	window.__sdvLoaderStartupTimer = window.setTimeout(() => {
		if (window.__sdvLoaderStarted) return;
		bootLoadingTitle.textContent = "Game script did not start";
		bootLoadingDetail.textContent = `${gameScript?.src || "game.js"} did not start. Deploy it beside index.html, then reload the page.`;
	}, 15000);
}

window.addEventListener("error", (event) => {
	if (openedFromFile) return;
	showGameScriptFailure(event);
}, true);
if (!openedFromFile) gameScript?.addEventListener("error", showGameScriptFailure);
