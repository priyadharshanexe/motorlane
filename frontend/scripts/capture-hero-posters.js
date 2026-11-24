async (page) => {
  // Hero posters: stills of the real 3D road (night and day, desktop and phone framing) for the moments before WebGL is
  // ready and for devices that do not run it. Run with Playwright's run-code against a local server on :8000, in a
  // browser you launch; then convert with scripts/posters.py. The header, copy, dashboard and the scene's own
  // darkening layer are hidden while capturing, so the poster is only the scene.
  const b = page.context().browser(); const out = [];
  const dir = 'C:/Users/darsh/Desktop/vehicle_rental/frontend/scripts/posters-raw/';
  for (const [frame, w, h, dpr] of [['desktop', 1920, 870, 1], ['phone', 390, 844, 2]]) for (const theme of ['dark', 'light']) {
    const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: theme, reducedMotion: 'no-preference' });
    await c.addInitScript(t => { try { localStorage.setItem('motorlane-theme', t); localStorage.setItem('motorlane-3d', 'always'); } catch { /* ignore */ } }, theme);
    const p = await c.newPage();
    await p.goto('http://127.0.0.1:8000/app/', { waitUntil: 'networkidle' });
    await p.waitForSelector('.od-hero-scene canvas', { timeout: 20000 });
    await p.waitForTimeout(4500);
    await p.addStyleTag({ content: '.od-header,.od-hero-copy,.od-dash,.od-hud,.od-backdrop,.od-streaks,.static-overlay{visibility:hidden!important}.od-hero-scene::after{display:none!important}' });
    await p.waitForTimeout(400);
    const file = `${dir}hero-${theme}-${frame}.png`;
    await p.locator('.od-hero-scene').screenshot({ path: file });
    out.push(file);
    await c.close();
  }
  return out;
}
