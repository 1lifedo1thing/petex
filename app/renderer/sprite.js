// Codex atlas: eight columns, 192 × 208 cells. Version 2 adds 16 gaze poses.
export const ANIMATIONS = {
  idle: {row: 0, durations: [280,110,110,140,140,320]},
  'running-right': {row: 1, durations: [120,120,120,120,120,120,120,220]},
  'running-left': {row: 2, durations: [120,120,120,120,120,120,120,220]},
  waving: {row: 3, durations: [140,140,140,280]},
  jumping: {row: 4, durations: [140,140,140,140,280]},
  failed: {row: 5, durations: [140,140,140,140,140,140,140,240]},
  waiting: {row: 6, durations: [150,150,150,150,150,260]},
  running: {row: 7, durations: [120,120,120,120,120,220]},
  review: {row: 8, durations: [150,150,150,150,150,280]},
};
export function availableAnimations(pet) {
  return pet?.builtin
    ? ['waving', 'jumping', 'running-left', 'running-right']
    : ['waving', 'jumping', 'failed', 'waiting', 'running', 'review', 'running-left', 'running-right'];
}

// Use a deadline instead of queued timeouts so hidden or paused pets never catch up.
export class RandomAnimations {
  constructor(random = () => Math.random()) { this.random = random; this.reset(); }
  reset() { this.nextAt = null; this.previous = null; }
  delay() { return 12000 + this.random() * 18000; }
  next(pet, now, enabled, busy = false) {
    if (!enabled) { this.nextAt = null; return null; }
    if (this.nextAt === null || busy) { this.nextAt = now + this.delay(); return null; }
    if (now < this.nextAt) return null;
    const choices = availableAnimations(pet).filter(name => name !== this.previous);
    const name = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
    const cycles = 1 + Math.floor(this.random() * 3);
    const duration = ANIMATIONS[name].durations.reduce((a, b) => a + b, 0) * cycles;
    this.previous = name;
    this.nextAt = now + duration + this.delay();
    return {name, duration};
  }
}

export function animationFrame(state, elapsed) {
  const animation = ANIMATIONS[state] || ANIMATIONS.idle;
  let time = elapsed % animation.durations.reduce((a,b) => a+b, 0);
  let frame = 0;
  while (time >= animation.durations[frame] && frame < animation.durations.length-1) time -= animation.durations[frame++];
  return {row: animation.row, frame};
}
export function gazeFrame(x, y) {
  const angle = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);
  const direction = Math.round(angle / (Math.PI / 8)) % 16;
  return {row: 9 + Math.floor(direction / 8), frame: direction % 8};
}
function ellipse(ctx, x,y,rx,ry, fill) {ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fillStyle=fill;ctx.fill();}
function shape(ctx, data, color) {ctx.fillStyle=color;ctx.fill(new Path2D(data));}
export function drawMiso(ctx, time = 0, state = 'idle', gaze = null, motion = true, actionTime = time) {
  const breathe = motion ? Math.sin(time / 800) : 0;
  const hopping = state === 'jumping' ? -Math.sin(Math.min(1, actionTime / 840) * Math.PI) * 22 : 0;
  const walking = state.startsWith('running-');
  const sway = walking ? Math.sin(time/85)*3 : 0;
  ctx.save(); ctx.translate(0, breathe + hopping);
  if (state === 'running-left') {ctx.translate(192,0);ctx.scale(-1,1);}
  // Original vector companion. It is independent of the imported Codex artwork.
  const fur='#aaa9a5', cream='#fff4e1', stripe='#7e7e7b', ink='#50514f';
  ctx.save();ctx.translate(120,158);ctx.rotate((motion ? Math.sin(time/650)*0.09 : 0) + (walking ? .3 : 0));
  ctx.beginPath();ctx.moveTo(0,9);ctx.bezierCurveTo(27,13,34,-8,23,-27);ctx.strokeStyle=fur;ctx.lineWidth=9;ctx.lineCap='round';ctx.stroke();ctx.restore();
  ellipse(ctx,96,143,28,39,fur);
  ellipse(ctx,96,147,18,28,cream);
  ellipse(ctx,81,178+sway,10,10,fur);ellipse(ctx,111,178-sway,10,10,fur);
  if (state === 'waving') {
    ctx.save();ctx.translate(124,127);ctx.rotate(Math.sin(time/100)*.3-.5);ellipse(ctx,0,-13,7,23,fur);ctx.restore();
  } else {ellipse(ctx,122,146+sway,7,21,fur);}
  ellipse(ctx,70,146-sway,7,21,fur);
  shape(ctx,'M 49 76 L 47 26 Q 47 15 56 20 L 79 42 Q 96 38 113 42 L 136 20 Q 145 15 145 26 L 143 76 Z',fur);
  shape(ctx,'M 55 52 L 54 29 L 72 46 Z M 120 46 L 138 29 L 137 52 Z',cream);
  ellipse(ctx,96,79,48,40,fur);
  shape(ctx,'M 80 41 Q 81 58 86 58 Q 90 56 89 40 Z M 92 39 Q 93 62 98 62 Q 103 60 101 39 Z M 105 40 Q 106 58 111 57 Q 116 54 114 42 Z',stripe);
  ellipse(ctx,96,96,34,22,cream);
  const eyeX = gaze ? Math.max(-5,Math.min(5,gaze.x/45)) : 0;
  const eyeY = gaze ? Math.max(-4,Math.min(4,gaze.y/55)) : 0;
  const blink = motion && time % 4700 > 4520;
  for (const x of [78,114]) {
    ellipse(ctx,x+eyeX,77+eyeY,6,blink?1.3:8.5,ink);
    if (!blink) ellipse(ctx,x+eyeX+1.5,74+eyeY,1.8,2,cream);
  }
  ctx.strokeStyle=ink;ctx.lineWidth=3;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(88,95);ctx.quadraticCurveTo(96,104,104,95);ctx.stroke();
  ctx.restore();
}
export class PetSprite {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', {willReadFrequently: true});
    this.pet = null;this.image=null;this.state='idle';this.started=performance.now();this.motion=true;this.gaze=null;this.last=0;this.raf=0;this.stopped=false;
    canvas.width=384;canvas.height=416;
    this.tick=this.tick.bind(this);this.tick(0);
  }
  async setPet(pet) {
    if (this.pet?.id === pet.id) return;
    this.pet=pet;this.image=null;
    if (!pet.builtin) {
      const image=new Image();image.crossOrigin='anonymous';image.src=pet.assetUrl;
      await image.decode();
      if(this.pet.id===pet.id)this.image=image;
    }
  }
  action(state) {this.state=state;this.started=performance.now();}
  tick(now) {
    if(this.stopped)return;
    this.raf=requestAnimationFrame(this.tick);
    if(now-this.last<40)return;this.last=now;
    const elapsed=this.motion?now-this.started:0;
    const pose=this.motion && this.gaze && this.pet?.spriteVersionNumber===2 && this.state==='idle' ? gazeFrame(this.gaze.x,this.gaze.y) : animationFrame(this.motion?this.state:'idle',elapsed);
    const renderKey=JSON.stringify([this.pet?.id,!!this.image,this.pet?.builtin&&this.motion?Math.floor(now/40):0,pose,this.motion,this.gaze]);
    if(this.renderKey===renderKey)return;this.renderKey=renderKey;
    const ctx=this.ctx;ctx.clearRect(0,0,384,416);ctx.save();ctx.scale(2,2);
    if(this.pet?.builtin)drawMiso(ctx,this.motion?now:0,this.motion?this.state:'idle',this.motion?this.gaze:null,this.motion,elapsed);
    else if(this.image) {
      ctx.drawImage(this.image,pose.frame*192,pose.row*208,192,208,0,0,192,208);
    }
    ctx.restore();
  }
  stop() {this.stopped=true;cancelAnimationFrame(this.raf);}
}
