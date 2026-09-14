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
  const breathe = motion ? Math.sin(time / 800) * 1.5 : 0;
  const hopping = state === 'jumping' ? -Math.sin(Math.min(1, actionTime / 840) * Math.PI) * 22 : 0;
  const walking = state.startsWith('running-');
  const sway = walking ? Math.sin(time/85)*3 : 0;
  ctx.save(); ctx.translate(0, breathe + hopping);
  if (state === 'running-left') {ctx.translate(192,0);ctx.scale(-1,1);}
  // Original vector companion. It is independent of the imported Codex artwork.
  ctx.save();ctx.translate(147,151);ctx.rotate((motion ? Math.sin(time/650)*0.09 : 0) + (walking ? .3 : 0));
  shape(ctx,'M -7 14 C 34 16 42 -8 30 -30 C 25 -40 13 -36 16 -26 C 23 -11 11 -5 -7 -8 Z','#c78144');ctx.restore();
  ellipse(ctx,95,145,47,44,'#e6a55f');
  ellipse(ctx,94,150,29,31,'#ffdda0');
  ellipse(ctx,68,179+sway,19,11,'#d98e49');ellipse(ctx,119,179-sway,19,11,'#d98e49');
  if (state === 'waving') {
    ctx.save();ctx.translate(143,128);ctx.rotate(Math.sin(time/100)*.3-.5);ellipse(ctx,0,-13,12,26,'#e6a55f');ellipse(ctx,0,-27,6,7,'#ffc38e');ctx.restore();
  } else {ellipse(ctx,135,150+sway,11,24,'#e6a55f');}
  ellipse(ctx,54,150-sway,11,24,'#e6a55f');
  shape(ctx,'M 42 81 L 38 30 Q 39 19 49 25 L 77 47 Q 98 41 119 47 L 145 24 Q 154 19 155 33 L 150 85 Z','#e6a55f');
  shape(ctx,'M 47 61 L 46 35 L 67 53 Z','#edb28b');shape(ctx,'M 131 52 L 147 35 L 146 62 Z','#edb28b');
  ellipse(ctx,97,88,62,48,'#efb775');
  shape(ctx,'M 84 43 Q 85 60 90 63 Q 95 59 92 43 Z M 99 42 Q 98 61 104 63 Q 110 59 108 43 Z','#ce8a49');
  ellipse(ctx,82,104,18,14,'#ffdda0');ellipse(ctx,109,104,18,14,'#ffdda0');
  const eyeX = gaze ? Math.max(-5,Math.min(5,gaze.x/45)) : 0;
  const eyeY = gaze ? Math.max(-4,Math.min(4,gaze.y/55)) : 0;
  const blink = motion && time % 4700 > 4520;
  for (const x of [73,120]) {
    ellipse(ctx,x+eyeX,85+eyeY,5.4,blink?1.3:7.2,'#493729');
    if (!blink) ellipse(ctx,x+eyeX+1.5,83+eyeY,1.5,2,'#fff4dc');
  }
  ellipse(ctx,56,101,9,4,'#e6a07a');ellipse(ctx,136,101,9,4,'#e6a07a');
  shape(ctx,'M 91 100 Q 97 96 103 100 Q 98 108 95 105 Z','#88583e');
  ctx.strokeStyle='#80543a';ctx.lineWidth=1.8;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(97,105);ctx.quadraticCurveTo(95,114,89,109);ctx.moveTo(97,105);ctx.quadraticCurveTo(99,114,105,109);ctx.stroke();
  shape(ctx,'M 65 128 Q 96 139 127 127 L 127 134 Q 97 146 65 136 Z','#61724a');
  ellipse(ctx,98,139,7,8,'#f7d77d');ellipse(ctx,98,141,1.3,2,'#ab8337');
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
