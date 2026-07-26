import type { PlayerControls } from './controls';

const JOY_R = 58; // joystick thumb travel radius (px)

/**
 * On-screen touch controls: a virtual joystick (bottom-left) for movement, swipe
 * anywhere on the canvas to look, a tap (or the round button) to interact.
 */
export class TouchControls {
  private root = document.createElement('div');
  private joy = document.createElement('div');
  private thumb = document.createElement('div');
  private btn = document.createElement('button');
  private jumpBtn = document.createElement('button');

  private joyId: number | null = null;
  private joyCx = 0;
  private joyCy = 0;

  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private tapStart = 0;
  private tapMoved = 0;

  constructor(
    private controls: PlayerControls,
    canvas: HTMLElement,
    private onInteract: () => void,
  ) {
    this.root.id = 'touch';
    this.joy.id = 'joystick';
    this.thumb.id = 'joythumb';
    this.joy.appendChild(this.thumb);
    this.btn.id = 'touchInteract';
    this.btn.textContent = 'E';
    this.jumpBtn.id = 'touchJump';
    this.jumpBtn.textContent = '⤒';
    this.jumpBtn.setAttribute('aria-label', 'Jump');
    this.root.append(this.joy, this.btn, this.jumpBtn);
    document.body.appendChild(this.root);

    this.joy.addEventListener('touchstart', this.onJoyStart, { passive: false });
    this.btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onInteract();
    }, { passive: false });
    this.jumpBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.controls.jump();
    }, { passive: false });
    canvas.addEventListener('touchstart', this.onLookStart, { passive: true });
    // Passive: we never preventDefault here (canvas/joystick use touch-action:none to
    // stop page scroll during play), so this can't block scrolling in menus/overlays.
    window.addEventListener('touchmove', this.onMove, { passive: true });
    window.addEventListener('touchend' , this.onEnd);
    window.addEventListener('touchcancel', this.onEnd);
  }

  enable() { this.root.classList.add('show'); }
  disable() {
    this.root.classList.remove('show');
    this.resetJoy(); 
    this.joyId = null;
    this.lookId = null;
  }

  private onJoyStart = (e: TouchEvent) => {
    e.preventDefault();
    if (this.joyId !== null) return;
    const t = e.changedTouches[0];
    this.joyId = t.identifier;
    const r = this.joy.getBoundingClientRect();
    this.joyCx = r.left + r.width / 2;
    this.joyCy = r.top + r.height / 2;
    this.updateJoy(t.clientX, t.clientY);
  };

  private onLookStart = (e: TouchEvent) => {
    if (this.lookId !== null) return;
    const t = e.changedTouches[0];
    this.lookId = t.identifier;
    this.lookX = t.clientX;
    this.lookY = t.clientY;
    this.tapStart = Date.now();
    this.tapMoved = 0;
  };

  private onMove = (e: TouchEvent) => {
    if (this.joyId === null && this.lookId === null) return; // let overlays/menus scroll freely
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyId) {
        this.updateJoy(t.clientX, t.clientY);
      } else if (t.identifier === this.lookId) {
        const dx = t.clientX - this.lookX, dy = t.clientY - this.lookY;
        this.lookX = t.clientX;
        this.lookY = t.clientY;
        this.tapMoved += Math.hypot(dx, dy);
        this.controls.applyLook(dx, dy);
      }
    }
  };

  private onEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyId) {
        this.joyId = null;
        this.resetJoy();
      } else if (t.identifier === this.lookId) {
        const quickTap = Date.now() - this.tapStart < 250 && this.tapMoved < 14;
        this.lookId = null;
        if (quickTap) {
          // Suppress the browser's synthesized mouse click for this tap: otherwise
          // it lands on whatever overlay button (e.g. a floor button) the orb tap
          // just rendered under the finger, instantly travelling to some year.
          e.preventDefault();
          this.onInteract();
        }
      }
    }
  };

  private updateJoy(x: number, y: number) {
    let dx = x - this.joyCx, dy = y - this.joyCy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_R) { dx = (dx / d) * JOY_R; dy = (dy / d) * JOY_R; }
    this.thumb.style.transform = `translate(${dx}px, ${dy}px)`;
    this.controls.setMove(dx / JOY_R, -dy / JOY_R); // screen-y down → forward is up
  }

  private resetJoy() {
    this.thumb.style.transform = 'translate(0, 0)';
    this.controls.setMove(0, 0);
  }
}
