# Static deployment

The site has no server-side runtime or build step. Publish the contents of this directory as the site's root. Keep the `_framework` directory, all `Content.tar*` and `ContentAudio.tar*` files, and the `.nojekyll` marker together.

Do not open `index.html` directly from a `file://` URL. Browsers block the module script and game-asset requests in that mode. Preview the site through a local HTTP server, or open its HTTPS URL after deployment.

## GitHub Pages

1. Put the contents of this directory in a GitHub repository. Every file is split below GitHub's 100 MiB single-file limit.
2. In the repository settings, enable Pages and publish from the branch and folder containing `index.html`.
3. Keep the `.nojekyll` marker at the root so GitHub Pages publishes `_framework`.

The static site payload is about 610 MiB, below GitHub Pages' [1 GB published-site limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits). The repository is large; use a fresh repository and avoid retaining old copies of the game assets in Git history.

## Cloudflare Pages

Create a Pages project with this directory as its build output and no build command, or run Wrangler from this directory:

```powershell
npx wrangler pages deploy . --project-name stardew-valley-browser
```

The site uses fewer than 1,000 files. Its largest individual files are 20 MiB, below Cloudflare Pages' [25 MiB per-file limit](https://developers.cloudflare.com/pages/platform/limits/). `_headers` sets the WebAssembly MIME type for framework assets.

## Browser storage and loading

On first launch, the browser downloads the full content and audio archives, stores them in Origin Private File System (OPFS) when available, then copies every file into the game runtime before starting. The loading screen reports archive-part progress followed by the exact number of game files being loaded. A single start click after download supplies the browser gesture needed for game audio; there is no music-skip option. Later launches can reuse the cached archives. Browser storage must have enough space for the downloaded archives and game files.
