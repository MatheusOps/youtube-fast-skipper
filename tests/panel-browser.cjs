const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('playwright-core');
}

const root = path.resolve(__dirname, '..');
const fixtureUrl = 'http://127.0.0.1:41739/watch?v=panel-fixture';
const sourceText = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const productionGuard = "if (location.hostname !== 'www.youtube.com') return;";
assert.equal(sourceText.split(productionGuard).length - 1, 1, 'the test-only localhost guard must match the known production guard exactly once');
const source = sourceText.replace(productionGuard, "if (location.hostname !== '127.0.0.1') return;");

const playerMarkup = ({position = 'fixed', left = 120, top = 80, playerStyle = '', videoStyle = '', card = ''} = {}) => `${card}<div class="html5-video-player" style="position:${position};left:${left}px;top:${top}px;width:640px;height:360px;background:#123;${playerStyle}">
  <video style="width:640px;height:360px;${videoStyle}"></video>
  <div class="ytp-progress-bar" style="position:absolute;left:0;bottom:0;width:640px;height:8px;background:#e33"></div>
</div>`;

const scenarios = [
  {
    name: 'watch fixed player escapes zero-height html and body',
    pathname: '/watch?v=panel-fixture',
    css: 'html,body{height:0;overflow:hidden;margin:0}',
    markup: `<div id="movie_player">${playerMarkup()}</div>`,
    expectVisible: true,
    checkZeroHeightRoot: true,
  },
  {
    name: 'watch absolute player remains visible with zero-height html and body',
    pathname: '/watch?v=panel-fixture',
    css: 'html,body{height:0;overflow:hidden;margin:0}',
    markup: `<div id="movie_player">${playerMarkup({position: 'absolute'})}</div>`,
    expectVisible: true,
    checkZeroHeightRoot: true,
  },
  {
    name: 'watch fixed player escapes display contents overflow shell',
    pathname: '/watch?v=panel-fixture',
    css: 'html,body{margin:0}.shell{display:contents;overflow:hidden}',
    markup: `<div class="shell"><div id="movie_player">${playerMarkup()}</div></div>`,
    expectVisible: true,
  },
  {
    name: 'watch fixed player escapes a static zero-height overflow shell',
    pathname: '/watch?v=panel-fixture',
    css: 'html,body{margin:0}.shell{position:static;height:0;overflow:hidden}',
    markup: `<div class="shell"><div id="movie_player">${playerMarkup()}</div></div>`,
    expectVisible: true,
  },
  {
    name: 'watch absolute player escapes a static zero-height overflow shell when Chrome paints the video',
    pathname: '/watch?v=panel-fixture',
    css: 'html,body{margin:0}.shell{position:static;height:0;overflow:hidden}',
    markup: `<div class="shell"><div id="movie_player">${playerMarkup({position: 'absolute'})}</div></div>`,
    expectVisible: true,
    paintProbe: {x: 440, y: 260, expectedTag: 'VIDEO'},
  },
  {
    name: 'known Shorts card remains visible inside a zero-height root',
    pathname: '/shorts/known',
    css: 'html,body{margin:0}.root{height:0;overflow:hidden}',
    markup: `<div class="root"><ytd-reel-video-renderer is-active>${playerMarkup()}</ytd-reel-video-renderer></div>`,
    expectVisible: true,
  },
  {
    name: 'Shorts fixed player escapes a static video in a zero-height overflow shell',
    pathname: '/shorts/static-video-shell',
    css: 'html,body{margin:0}.shell{position:static;height:0;overflow:hidden}',
    markup: `<div class="shell"><ytd-reel-video-renderer is-active>${playerMarkup()}</ytd-reel-video-renderer></div>`,
    expectVisible: true,
  },
  {
    name: 'unknown Shorts card falls back to its visible video',
    pathname: '/shorts/unknown',
    css: 'html,body{margin:0}',
    markup: `<yt-shorts-video-view-model>${playerMarkup()}</yt-shorts-video-view-model>`,
    expectVisible: true,
  },
  {
    name: 'open shadow-root Shorts card remains supported',
    pathname: '/shorts/shadow',
    css: 'html,body{margin:0}',
    markup: '<div id="shadow-host"></div>',
    setup: `const root = document.querySelector('#shadow-host').attachShadow({mode:'open'}); root.innerHTML = ${JSON.stringify(`<ytd-reel-video-renderer is-active>${playerMarkup()}</ytd-reel-video-renderer>`)};`,
    expectVisible: true,
  },
  {
    name: 'watch panel stays hidden when its video is hidden',
    pathname: '/watch?v=panel-fixture',
    css: 'html,body{margin:0}',
    markup: `<div id="movie_player">${playerMarkup({videoStyle: 'visibility:hidden;'})}</div>`,
    expectVisible: false,
  },
  {
    name: 'Shorts panel stays hidden when the video is fully clipped',
    pathname: '/shorts/clipped',
    css: 'html,body{margin:0}.clipper{position:relative;width:640px;height:0;overflow:hidden}',
    markup: `<ytd-reel-video-renderer is-active><div class="clipper">${playerMarkup({position: 'absolute'})}</div></ytd-reel-video-renderer>`,
    expectVisible: false,
    paintProbe: {x: 440, y: 260, expectedTag: 'HTML'},
  },
  {
    name: 'Shorts panel stays hidden when the fixed player clips its child video',
    pathname: '/shorts/player-clips-child',
    css: 'html,body{margin:0}',
    markup: `<ytd-reel-video-renderer is-active>${playerMarkup({playerStyle: 'height:0;overflow:hidden;'})}</ytd-reel-video-renderer>`,
    expectVisible: false,
    paintProbe: {x: 440, y: 260, expectedTag: 'HTML'},
  },
  {
    name: 'Shorts panel stays hidden when a transformed containing block clips its fixed player',
    pathname: '/shorts/transformed-clip',
    css: 'html,body{margin:0}.containing{position:relative;width:640px;height:0;overflow:hidden;transform:translateZ(0)}',
    markup: `<div class="containing"><ytd-reel-video-renderer is-active>${playerMarkup()}</ytd-reel-video-renderer></div>`,
    expectVisible: false,
    paintProbe: {x: 440, y: 260, expectedTag: 'HTML'},
  },
  {
    name: 'Shorts panel stays hidden when an outer clip encloses a transformed containing block',
    pathname: '/shorts/outer-clip',
    css: 'html,body{margin:0}.outer{height:0;overflow:hidden}.containing{position:relative;width:640px;height:0;transform:translateZ(0)}',
    markup: `<div class="outer"><div class="containing"><ytd-reel-video-renderer is-active>${playerMarkup()}</ytd-reel-video-renderer></div></div>`,
    expectVisible: false,
    paintProbe: {x: 440, y: 260, expectedTag: 'HTML'},
  },
];

function urlFor(scenario) {
  return new URL(scenario.pathname, fixtureUrl).href;
}

async function waitForPanel(page, visible) {
  await page.waitForFunction(expected => {
    const host = document.getElementById('video-turbo-controls');
    if (!host) return expected === false;
    const style = getComputedStyle(host);
    return (style.display !== 'none' && Number(style.opacity) > 0.01) === expected;
  }, visible, {timeout: 5000});
}

async function waitForInitialScan(page) {
  await page.waitForFunction(() => window.__panelTestRafRuns > 0, {timeout: 5000});
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function runScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: {width: 1280, height: 800},
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const pageErrors = [];
  const unexpectedRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await context.route('**/*', async route => {
    if (route.request().url() === urlFor(scenario)) {
      const body = `<!doctype html><html><head><meta charset="utf-8"><style>${scenario.css}</style></head><body>${scenario.markup}</body></html>`;
      await route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body});
      return;
    }
    unexpectedRequests.push(route.request().url());
    await route.abort();
  });
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.__panelTestRafRuns = 0;
    window.requestAnimationFrame = callback => requestFrame(timestamp => {
      try { callback(timestamp); }
      finally { window.__panelTestRafRuns += 1; }
    });
    window.chrome = {
      runtime: {onMessage: {addListener() {}}, sendMessage: async () => ({ok: false})},
      storage: {
        local: {get: async defaults => ({...defaults, speed: 1.5}), set: async () => {}},
        onChanged: {addListener() {}},
      },
    };
  });
  try {
    await page.goto(urlFor(scenario), {waitUntil: 'domcontentloaded'});
    if (scenario.setup) await page.evaluate(scenario.setup);
    await page.addScriptTag({content: source});
    await waitForInitialScan(page);
    if (scenario.paintProbe) {
      const painted = await page.evaluate(({x, y}) => {
        const target = document.elementFromPoint(x, y);
        return {tagName: target?.tagName || null, id: target?.id || null, className: target?.className || null};
      }, scenario.paintProbe);
      assert.equal(painted.tagName, scenario.paintProbe.expectedTag,
        `${scenario.name}: unexpected painted hit target at the video point ${JSON.stringify(painted)}`);
    }
    await waitForPanel(page, scenario.expectVisible);

    const display = await page.evaluate(() => {
      const host = document.getElementById('video-turbo-controls');
      if (!host) return {host: false};
      const style = getComputedStyle(host);
      return {host: true, display: style.display, opacity: style.opacity};
    });
    if (scenario.expectVisible) assert.equal(display.host, true, `${scenario.name}: panel host was not created`);
    assert.equal(display.display !== 'none' && Number(display.opacity) > 0.01, scenario.expectVisible,
      `${scenario.name}: unexpected computed panel visibility ${JSON.stringify(display)}`);

    if (scenario.expectVisible) {
      const button = page.locator('#video-turbo-controls').getByRole('button', {name: 'Increase speed'});
      try {
        await button.waitFor({state: 'visible', timeout: 3000});
      } catch (error) {
        const state = await page.evaluate(() => {
          const host = document.getElementById('video-turbo-controls');
          const button = host?.shadowRoot?.getElementById('plus');
          const rect = element => element && ({left: element.getBoundingClientRect().left, top: element.getBoundingClientRect().top,
            width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height});
          return {host: rect(host), button: rect(button), hostDisplay: host && getComputedStyle(host).display,
            hostOpacity: host && getComputedStyle(host).opacity, buttonDisplay: button && getComputedStyle(button).display,
            buttonVisibility: button && getComputedStyle(button).visibility};
        });
        throw new Error(`${error.message}; button state ${JSON.stringify(state)}`);
      }
      const hitTarget = await button.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const host = document.getElementById('video-turbo-controls');
        const documentTarget = document.elementFromPoint(x, y);
        const shadowTarget = host.shadowRoot.elementFromPoint(x, y);
        return {
          documentHitsHost: documentTarget === host,
          shadowHitsButton: shadowTarget === element,
          rect: {x, y, width: rect.width, height: rect.height},
        };
      });
      assert.equal(hitTarget.documentHitsHost, true, `${scenario.name}: panel does not receive page hit-testing`);
      assert.equal(hitTarget.shadowHitsButton, true, `${scenario.name}: speed button is not the hit-tested target`);

      const before = await page.locator('video').evaluate(video => video.playbackRate);
      await button.click();
      await page.waitForFunction(previous => {
        const video = document.querySelector('video') || document.querySelector('#shadow-host')?.shadowRoot?.querySelector('video');
        return video?.playbackRate > previous;
      }, before, {timeout: 3000});
    }

    if (scenario.checkZeroHeightRoot) {
      const geometry = await page.evaluate(() => ({
        html: document.documentElement.getBoundingClientRect().height,
        body: document.body.getBoundingClientRect().height,
        video: document.querySelector('video').getBoundingClientRect().height,
        progress: document.querySelector('.ytp-progress-bar').getBoundingClientRect().height,
      }));
      assert.equal(geometry.html, 0);
      assert.equal(geometry.body, 0);
      assert.ok(geometry.video > 0 && geometry.progress > 0, `fixture must have visible media geometry: ${JSON.stringify(geometry)}`);
    }

    assert.deepEqual(unexpectedRequests, [], `${scenario.name}: page attempted a request outside its localhost fixture`);
    assert.deepEqual(pageErrors, [], `${scenario.name}: page errors: ${pageErrors.join('; ')}`);
  } finally {
    await context.close();
  }
}

async function runProgressBarToggle(browser) {
  const scenario = {
    name: 'watch progress bar visibility controls panel visibility',
    pathname: '/watch?v=panel-fixture',
    css: 'html,body{margin:0}',
    markup: `<div id="movie_player">${playerMarkup()}</div>`,
  };
  const context = await browser.newContext({viewport: {width: 1280, height: 800}, serviceWorkers: 'block'});
  const page = await context.newPage();
  const pageErrors = [];
  const unexpectedRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await context.route('**/*', async route => {
    if (route.request().url() === urlFor(scenario)) {
      const body = `<!doctype html><html><head><meta charset="utf-8"><style>${scenario.css}</style></head><body>${scenario.markup}</body></html>`;
      await route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body});
    } else {
      unexpectedRequests.push(route.request().url());
      await route.abort();
    }
  });
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.__panelTestRafRuns = 0;
    window.requestAnimationFrame = callback => requestFrame(timestamp => {
      try { callback(timestamp); }
      finally { window.__panelTestRafRuns += 1; }
    });
    window.chrome = {
      runtime: {onMessage: {addListener() {}}, sendMessage: async () => ({ok: false})},
      storage: {local: {get: async defaults => ({...defaults, speed: 1.5}), set: async () => {}}, onChanged: {addListener() {}}},
    };
  });
  try {
    await page.goto(urlFor(scenario), {waitUntil: 'domcontentloaded'});
    await page.addScriptTag({content: source});
    await waitForInitialScan(page);
    await waitForPanel(page, true);
    await page.locator('.ytp-progress-bar').evaluate(bar => {bar.style.display = 'none';});
    await waitForPanel(page, false);
    await page.locator('.ytp-progress-bar').evaluate(bar => {bar.style.display = 'block';});
    await waitForPanel(page, true);
    assert.deepEqual(unexpectedRequests, [], 'progress toggle attempted a request outside its localhost fixture');
    assert.deepEqual(pageErrors, [], `progress toggle page errors: ${pageErrors.join('; ')}`);
  } finally {
    await context.close();
  }
}

(async () => {
  const launchOptions = {headless: true};
  if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;
  const browser = await playwright.chromium.launch(launchOptions);
  const failures = [];
  try {
    for (const scenario of scenarios) {
      try {
        await runScenario(browser, scenario);
        console.log(`PASS ${scenario.name}`);
      } catch (error) {
        failures.push(`${scenario.name}: ${error.message}`);
        console.error(`FAIL ${scenario.name}: ${error.message}`);
      }
    }
    try {
      await runProgressBarToggle(browser);
      console.log('PASS watch progress bar visibility controls panel visibility');
    } catch (error) {
      failures.push(`watch progress bar visibility controls panel visibility: ${error.message}`);
      console.error(`FAIL watch progress bar visibility controls panel visibility: ${error.message}`);
    }
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`${failures.length} browser regression case(s) failed:\n${failures.join('\n')}`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
