import type { Floor } from './types';
import { EMBED_CHECK_URL } from './config';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, html?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Builds and owns every HTML overlay layered above the 3D canvas. */
export class UI {
  crosshair = el('div');
  prompt = el('div');
  floorLabel = el('div');
  private help = el('div');
  private start = el('div', 'overlay');
  private loading = el('div', 'overlay');
  private bar = el('i');
  private loadingMsg = el('div');
  private elevator = el('div', 'overlay hidden');
  private floorGrid = el('div', 'floor-grid');
  private video = el('div', 'overlay hidden');
  private videoWrap = el('div', 'frame-wrap');
  private videoTitle = el('div', 'vtitle');
  private web = el('div', 'overlay hidden');
  private webWrap = el('div', 'frame-wrap');
  private webTitle = el('div', 'vtitle');
  private webLink = el('a', 'web-open');
  private webToken = 0; // invalidates a pending embeddable-check if the popup changes
  private dialog = el('div');
  private dialogName = el('div', 'dname');
  private dialogText = el('div', 'dtext');
  private dialogProjects = el('div', 'dprojects');
  private curtain = el('div');
  private toast = el('div');
  private toastTimer = 0;

  // callbacks wired by main
  onStart?: () => void;
  onPickFloor?: (year: number) => void;
  onCloseOverlay?: () => void;

  constructor() {
    this.crosshair.id = 'crosshair';
    this.prompt.id = 'prompt';
    this.floorLabel.id = 'floorLabel';
    this.help.id = 'help';
    this.curtain.id = 'curtain';
    this.toast.id = 'toast';
    this.elevator.id = 'elevator'; // without these ids every #elevator / #video CSS rule is dead
    this.video.id = 'video';
    this.web.id = 'web';
    this.help.innerHTML =
      '<span class="key">W A S D</span> move &nbsp; <span class="key">Mouse</span> look &nbsp; ' +
      '<span class="key">Shift</span> run &nbsp; <span class="key">Space</span> jump<br>' +
      '<span class="key">E</span> / <span class="key">Click</span> interact &nbsp; ' +
      '<span class="key">M</span> mute &nbsp; ' +
      '<span class="key">Esc</span> release cursor';

    document.body.append(
      this.crosshair, this.prompt, this.floorLabel, this.help, this.curtain, this.toast,
    );

    this.buildStart();
    this.buildLoading();
    this.buildElevator();
    this.buildVideo();
    this.buildWeb();
    this.buildDialog();
  }

  // ---------- NPC dialog blurb ----------
  private buildDialog() {
    this.dialog.id = 'dialog';
    const hint = el('div', 'dhint', '<span class="key">E</span> close');
    this.dialog.append(this.dialogName, this.dialogText, this.dialogProjects, hint);
    document.body.append(this.dialog);
  }
  showDialog(name: string, text?: string, projects: string[] = []) {
    this.dialogName.textContent = name;
    const greetings = ['Hello', 'Hi there', 'Greetings', 'Hey'];
    const greeting = greetings[name.charCodeAt(0) % greetings.length];
    const desc = (text ?? '').trim().replace(/[.!]+$/, '');
    this.dialogText.textContent = desc
      ? `${greeting}, I am ${name}, ${desc}.`
      : `${greeting}, I am ${name}. We worked together on the Keep.`;
    this.dialogProjects.replaceChildren();
    if (projects.length) {
      this.dialogProjects.append(el('div', 'dplabel', 'Worked on this year'));
      const list = el('ul', 'dplist');
      for (const title of projects) {
        const li = el('li');
        li.textContent = title;
        list.append(li);
      }
      this.dialogProjects.append(list);
    }
    this.dialog.classList.add('show');
  }
  hideDialog() { this.dialog.classList.remove('show'); }
  get dialogOpen() { return this.dialog.classList.contains('show'); }

  // ---------- loading ----------
  private buildLoading() {
    const bar = el('div', 'bar');
    bar.append(this.bar);
    this.loadingMsg.id = 'loadingMsg';
    this.loading.append(
      el('h1', 'title', 'Slashie\'s Keep'),
      el('div', 'subtitle', 'Raising the castle walls…'),
      bar,
      this.loadingMsg,
    );
    document.body.append(this.loading);
  }
  setProgress(frac: number, msg?: string) {
    this.bar.style.width = Math.round(frac * 100) + '%';
    if (msg) this.loadingMsg.textContent = msg;
  }
  hideLoading() { this.loading.classList.add('hidden'); }

  // ---------- start screen ----------
  private buildStart() {
    this.start.classList.add('hidden');
    const btn = el('button', 'cta', 'Enter the Keep');
    btn.addEventListener('click', () => this.onStart?.());
    this.start.append(
      el('h1', 'title', 'Slashie\'s Keep'),
      el('div', 'subtitle', ''),
      btn,
      el('div', 'controls-legend',
        '<span><b>W A S D</b> move</span><span><b>Mouse</b> look</span>' +
        '<span><b>E</b> / <b>Click</b> interact</span><span><b>M</b> mute</span><span><b>Esc</b> menu</span>'),
    );
    document.body.append(this.start);
  }
  showStart(subtitle?: string, cta?: string) {
    const sub = this.start.querySelector('.subtitle') as HTMLElement | null;
    if (sub) sub.innerHTML = subtitle ?? '';
    if (cta) {
      const btn = this.start.querySelector('.cta') as HTMLElement | null;
      if (btn) btn.textContent = cta;
    }
    this.start.classList.remove('hidden');
  }
  hideStart() { this.start.classList.add('hidden'); }

  // ---------- HUD ----------
  setFloorLabel(year: number, count: number, total: number) {
    this.floorLabel.innerHTML =
      `<div class="yr">${year}</div>` +
      `<div class="sub">${count} project${count === 1 ? '' : 's'} · ${total} floors</div>`;
  }
  setPrompt(text: string | null) {
    if (text) {
      this.prompt.innerHTML = `<span class="key">E</span>${text}`;
      this.prompt.classList.add('show');
      this.crosshair.classList.add('active');
    } else {
      this.prompt.classList.remove('show');
      this.crosshair.classList.remove('active');
    }
  }

  // ---------- elevator directory ----------
  private buildElevator() {
    const panel = el('div', 'panel');
    const close = el('button', 'close-x', '×');
    close.addEventListener('click', () => this.onCloseOverlay?.());
    panel.append(
      close,
      el('h2', undefined, '🔮 The Orb'),
      el('div', 'hint', 'The orb can carry you to any year. Each realm gathers the projects start on and worked during that year — choose your destination.'),
      this.floorGrid,
    );
    this.elevator.append(panel);
    document.body.append(this.elevator);
  }
  populateFloors(floors: Floor[], current: number) {
    this.floorGrid.innerHTML = '';
    for (const f of floors) {
      const b = el('button', 'floor-btn' + (f.year === current ? ' current' : ''));
      b.innerHTML =
        `<span class="fy">${f.year}</span>` +
        `<span class="fc">${f.projects.length} project${f.projects.length === 1 ? '' : 's'}` +
        `${f.year === current ? ' · you are here' : ''}</span>`;
      b.addEventListener('click', () => this.onPickFloor?.(f.year));
      this.floorGrid.append(b);
    }
  }
  showElevator() { this.elevator.classList.remove('hidden'); }
  hideElevator() { this.elevator.classList.add('hidden'); }
  get elevatorOpen() { return !this.elevator.classList.contains('hidden'); }

  // ---------- video player ----------
  private buildVideo() {
    const close = el('button', 'close-x', '×');
    close.addEventListener('click', () => this.onCloseOverlay?.());
    const col = el('div', undefined);
    col.style.display = 'flex';
    col.style.flexDirection = 'column';
    col.style.gap = '12px';
    col.style.alignItems = 'center';
    col.append(this.videoTitle, this.videoWrap);
    this.video.append(close, col);
    document.body.append(this.video);
  }
  showVideo(id: string, title: string) {
    this.videoTitle.textContent = title;
    this.videoWrap.innerHTML =
      `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1&rel=0" ` +
      `allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    this.video.classList.remove('hidden');
  }
  hideVideo() {
    this.videoWrap.innerHTML = ''; // stop playback
    this.video.classList.add('hidden');
  }
  get videoOpen() { return !this.video.classList.contains('hidden'); }

  // ---------- web-page popup (devlog / source code / links) ----------
  private buildWeb() {
    const close = el('button', 'close-x', '×');
    close.addEventListener('click', () => this.onCloseOverlay?.());
    this.webLink.target = '_blank';
    this.webLink.rel = 'noopener noreferrer';
    this.webLink.textContent = 'Open in new tab ↗';
    const bar = el('div', 'web-bar');
    bar.append(this.webTitle, this.webLink);
    const col = el('div', 'web-col');
    col.append(bar, this.webWrap);
    this.web.append(close, col);
    document.body.append(this.web);
  }
  showWeb(url: string, title: string) {
    this.webTitle.textContent = title;
    this.webLink.href = url;
    this.web.classList.remove('hidden');
    void this.renderWebFrame(url, ++this.webToken);
  }
  // Many sites (GitHub, Steam, stores, wordpress.com…) refuse to be framed. We ask
  // the server-side header check first and, if it says no, show a message instead of
  // a dead "refused to connect" page. If the check is unavailable we optimistically
  // try the frame — the header "Open in new tab" link is always there as a fallback.
  private async renderWebFrame(url: string, token: number) {
    this.webWrap.replaceChildren(this.webMessage('Loading…'));
    let embeddable = true;
    try {
      const res = await fetch(`${EMBED_CHECK_URL}?url=${encodeURIComponent(url)}`);
      if (res.ok) embeddable = (await res.json())?.embeddable !== false;
    } catch {
      /* check unavailable → optimistically attempt the frame */
    }
    if (token !== this.webToken) return; // popup was closed or replaced while awaiting
    if (embeddable) {
      const frame = document.createElement('iframe');
      frame.src = url;
      frame.referrerPolicy = 'no-referrer';
      this.webWrap.replaceChildren(frame);
    } else {
      this.webWrap.replaceChildren(this.webBlockedMessage(url));
    }
  }
  private webMessage(text: string): HTMLElement {
    return el('div', 'web-msg', `<div class="web-msg-body">${text}</div>`);
  }
  private webBlockedMessage(url: string): HTMLElement {
    let host = 'This site';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep default */ }
    const wrap = el('div', 'web-msg');
    wrap.append(
      el('div', 'web-msg-title', '🔒 This page can’t be shown here'),
      el('div', 'web-msg-body',
        `<b>${host}</b> doesn’t allow being embedded in another site. Open it in a new tab to view it.`),
    );
    const cta = el('a', 'cta web-msg-cta', 'Open in new tab ↗');
    cta.href = url;
    cta.target = '_blank';
    cta.rel = 'noopener noreferrer';
    wrap.append(cta);
    return wrap;
  }
  hideWeb() {
    this.webToken++; // cancel any in-flight check
    this.webWrap.replaceChildren(); // stop any loading / media
    this.web.classList.add('hidden');
  }
  get webOpen() { return !this.web.classList.contains('hidden'); }

  // ---------- transient toast ----------
  flash(msg: string, ms = 1400) {
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), ms);
  }

  // ---------- travel curtain ----------
  async fade(on: boolean, ms = 450): Promise<void> {
    this.curtain.classList.toggle('on', on);
    await new Promise((r) => setTimeout(r, ms));
  }

  get anyOverlayOpen() { return this.elevatorOpen || this.videoOpen || this.webOpen; }
}
