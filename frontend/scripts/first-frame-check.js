// First-frame check (run with Playwright's run-code against a local server on :8000, in a browser you launch).
// Cold loads with the cache disabled, fast and slow 4G, 1920x870 / 1366x768 / 375 in both themes, for the catalog,
// a vehicle and home. Every animation frame for 2.6 s it checks that no image is wider than its card or gallery box
// and nothing paints without the app's styles, and reports CLS, LCP and the hand-off time. 0 problems expected.
// Frames are saved under docs/design/firstframe/ (git-excluded).
async (page) => {
  // Cold hard loads (no cache) of the catalog, a vehicle and home, fast and slow 4G, 3 sizes x 2 themes. A sampler that
  // starts before the document runs every animation frame for 2 s and records: any image wider than its card or gallery
  // box, any frame where text/images show without the app's styles, and when the overlay hands over. Chrome's
  // screencast frames are saved for strips.
  const b = page.context().browser(); const out = { runs: [], problems: [] };
  for (const ctx of b.contexts()) if (ctx !== page.context()) await ctx.close();
  const dir = 'C:/Users/darsh/Desktop/vehicle_rental/docs/design/firstframe/';
  const pages = [['catalog', '/app/vehicles'], ['detail', '/app/vehicles/16'], ['home', '/app/']];
  for (const net of ['fast', 'slow4g']) for (const [w, h] of [[1920, 870], [1366, 768], [375, 812]]) for (const scheme of ['dark', 'light']) for (const [name, path] of pages) {
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, isMobile: w < 768, hasTouch: w < 768, deviceScaleFactor: 1 });
    const p = await c.newPage(); const cdp = await c.newCDPSession(p);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (net === 'slow4g') { await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 }); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
    await p.addInitScript(() => {
      const log = window.__ff = { frames: 0, bad: [], unstyled: 0, handoff: null, firstPaint: null, cls: 0, lcp: 0 };
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) log.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver(l => { for (const e of l.getEntries()) log.lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
      const t0 = performance.now();
      const tick = () => {
        const t = performance.now() - t0;
        if (document.body) {
          log.frames++;
          const overlay = document.querySelector('.static-first');
          if (overlay && log.firstPaint === null) log.firstPaint = Math.round(t);
          for (const img of document.querySelectorAll('img')) {
            const r = img.getBoundingClientRect();
            if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
            const box = img.closest('.od-tag, .od-gallery-viewport, .od-tag-media, .od-rack-tag, .od-ticket-photo, .od-fleet-photo') ;
            const limit = box ? box.getBoundingClientRect().width + 1 : innerWidth * 0.7;
            if (r.width > limit) log.bad.push([Math.round(t), Math.round(r.width), Math.round(limit), img.getAttribute('alt')?.slice(0, 20)]);
          }
          // unstyled: visible text outside any app/overlay shell, or an .od-app without its background
          const shell = document.querySelector('.od-app');
          if (document.body.innerText.trim() && (!shell || getComputedStyle(shell).backgroundColor === 'rgba(0, 0, 0, 0)')) log.unstyled++;
          if (log.handoff === null && document.querySelector('.static-overlay.out')) log.handoff = Math.round(t);
        }
        if (t < 2600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const tag = `${name}-${net}-${w}-${scheme}`;
    const shots = (w === 1920 || w === 375);
    const nav = p.goto('http://127.0.0.1:8000' + path, { waitUntil: 'commit' });
    let i = 0;
    if (shots) {
      await nav;
      const until = Date.now() + 2000;
      while (Date.now() < until && i < 14) {
        await p.screenshot({ path: `${dir}${tag}/${String(i).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 55, timeout: 3000 }).catch(() => {});
        i++; await p.waitForTimeout(90);
      }
    } else await nav;
    await p.waitForTimeout(net === 'fast' ? 1800 : 3500);
    const log = await p.evaluate(() => window.__ff);
    const run = { tag, frames: log.frames, overlayPaint: log.firstPaint, handoff: log.handoff, oversized: log.bad.length, firstBad: log.bad[0] ?? null, unstyledFrames: log.unstyled, cls: +log.cls.toFixed(4), lcp: log.lcp };
    out.runs.push(run);
    if (run.oversized || run.unstyledFrames || run.cls > 0.01) out.problems.push(run);
    await c.close();
  }
  return { runs: out.runs.length, problems: out.problems, sample: out.runs.filter(r => r.tag.includes('catalog')).map(r => `${r.tag} paint ${r.overlayPaint} handoff ${r.handoff} lcp ${r.lcp}`) };
}
