import {PetSprite, ANIMATIONS, RandomAnimations} from './sprite.js';
const api=window.pedex, canvas=document.getElementById('pet'),sprite=new PetSprite(canvas);
const randomAnimations=new RandomAnimations();
const HOLD_MS=550, DRAG_THRESHOLD=6;
let settings,selectedPet,down=null,dragging=false,lastHit=null,actionUntil=0,holdTimer=null;
function cancelHold(){clearTimeout(holdTimer);holdTimer=null;}
function action(name,fromPress=false){
  if(!settings?.motion||!ANIMATIONS[name]||dragging||(down&&!fromPress))return;
  sprite.action(name);
  actionUntil=performance.now()+ANIMATIONS[name].durations.reduce((a,b)=>a+b,0);
  randomAnimations.reset();
}
function render(state){
  const next=state.settings;
  const pet=state.pets.find(p=>p.id===next.petId)||state.pets[0];
  if(pet.id!==selectedPet?.id||next.motion!==settings?.motion||next.visible!==settings?.visible||next.randomAnimations!==settings?.randomAnimations){
    randomAnimations.reset();actionUntil=0;sprite.action('idle');
  }
  if(down&&(!next.visible||pet.id!==selectedPet?.id))finishPointer(null,true);
  settings=next;selectedPet=pet;sprite.motion=settings.motion;
  sprite.setPet(pet).catch(()=>{sprite.setPet(state.pets[0]);});
}
api.onState(render);api.getState().then(render);api.onAction(name=>action(name));
api.onCursor(cursor=>{
  if(!settings)return;
  const now=performance.now();
  const rect=canvas.getBoundingClientRect();
  const x=cursor.x-rect.x,y=cursor.y-rect.y;
  const isDragging=cursor.dragging&&!!down;
  if(isDragging){
    dragging=true;down.moved=true;cancelHold();actionUntil=0;
    // v2 atlases provide all sixteen movement directions; v1 uses left/right rows.
    const state=selectedPet.builtin||selectedPet.spriteVersionNumber===2?'idle':cursor.direction;
    if(sprite.state!==state)sprite.action(state);
  } else if(now>=actionUntil&&sprite.state!=='idle')sprite.action('idle');
  const next=randomAnimations.next(selectedPet,now,settings.motion&&settings.visible&&settings.randomAnimations,!!down||isDragging||now<actionUntil);
  if(next){sprite.action(next.name);actionUntil=now+next.duration;}
  const gx=x-rect.width/2,gy=y-rect.height*.45;
  sprite.gaze=isDragging?cursor.dragGaze:settings.followCursor&&settings.motion&&Math.hypot(gx,gy)>35&&Math.hypot(gx,gy)<1100?{x:gx,y:gy}:null;
  let hit=false;
  if(x>=0&&y>=0&&x<rect.width&&y<rect.height){
    try{hit=sprite.ctx.getImageData(Math.floor(x/rect.width*384),Math.floor(y/rect.height*416),1,1).data[3]>30;}catch{hit=true;}
  }
  // Keep the entire gesture captured even when animation changes the silhouette.
  if(hit!==lastHit&&!down){lastHit=hit;api.hit(hit).catch(()=>{});}
});
canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0||down)return;
  down={x:event.screenX,y:event.screenY,id:event.pointerId,moved:false,longPressed:false};
  canvas.setPointerCapture(event.pointerId);
  api.pressStart().catch(()=>finishPointer(null,true));
  cancelHold();
  holdTimer=setTimeout(()=>{
    if(!down||down.moved||dragging)return;
    down.longPressed=true;action('jumping',true);
  },HOLD_MS);
});
canvas.addEventListener('pointermove',event=>{
  if(down&&Math.hypot(event.screenX-down.x,event.screenY-down.y)>=DRAG_THRESHOLD){down.moved=true;cancelHold();}
});
function finishPointer(event,cancelled=false){
  if(!down)return;
  const press=down;const moved=dragging||press.moved;
  down=null;dragging=false;cancelHold();
  if(canvas.hasPointerCapture(press.id))canvas.releasePointerCapture(press.id);
  // The main process completes the final position before persisting it.
  api.pressEnd().catch(()=>{});lastHit=null;
  if(moved||cancelled){sprite.action('idle');actionUntil=0;randomAnimations.reset();}
  else if(!press.longPressed)action('waving');
}
canvas.addEventListener('pointerup',event=>finishPointer(event));
canvas.addEventListener('pointercancel',event=>finishPointer(event,true));
canvas.addEventListener('lostpointercapture',event=>finishPointer(event,true));
window.addEventListener('blur',()=>finishPointer(null,true));
canvas.addEventListener('contextmenu',event=>{event.preventDefault();finishPointer(null,true);api.menu();});
