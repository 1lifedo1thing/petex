import {PetSprite, ANIMATIONS, availableAnimations} from './sprite.js';
const $=id=>document.getElementById(id);
const api=window.pedex;
const hero=new PetSprite($('hero-pet'));
let state, cards=[], collectionKey='', toastTimer, actionTimer, busy=false;
function toast(message,error=false) {clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?8000:4200);}
async function run(action) {try{return await action();}catch(error){toast(error.message,true);return null;}}
async function update(patch) {return run(()=>api.updateSettings(patch));}
function playAnimation() {const name=$('animation').value;if(!state.settings.motion)return;hero.action(name);clearTimeout(actionTimer);actionTimer=setTimeout(()=>hero.action('idle'),ANIMATIONS[name].durations.reduce((a,b)=>a+b,0));run(()=>api.playAnimation(name));}
function render(next) {
  state=next;
  const {settings,pets}=state;
  const pet=pets.find(p=>p.id===settings.petId)||pets[0];
  hero.setPet(pet).catch(()=>toast('This sprite image could not be decoded. Try importing another pet.',true));
  hero.motion=settings.motion;
  $('pet-name').textContent=pet.displayName;
  const animations=availableAnimations(pet);
  if($('animation').dataset.petId!==pet.id){
    $('animation').dataset.petId=pet.id;
    $('animation').replaceChildren(...animations.map(name=>{const option=document.createElement('option');option.value=name;option.textContent=({waving:'Wave',jumping:'Jump',failed:'Sad',waiting:'Wait',running:'Work',review:'Look', 'running-left':'Walk left','running-right':'Walk right'})[name];return option;}));
    clearTimeout(actionTimer);hero.action('idle');
  }
  $('play').disabled=!settings.motion;
  $('animation').disabled=!settings.motion;
  $('presence').textContent=!settings.visible?'Hidden':!settings.motion?'Animation paused':'Visible on desktop';
  $('pet-count').textContent=pets.length;
  $('size').value=settings.size;
  $('size-description').textContent=`${settings.size} px`;
  for(const key of ['alwaysOnTop','motion','randomAnimations','followCursor','launchAtLogin','visible'])$(key).checked=settings[key];
  $('launchAtLogin').disabled=!state.loginAvailable;
  $('login-description').hidden=state.loginAvailable;
  $('login-description').textContent='Requires the installed app';
  $('randomAnimations').disabled=!settings.motion;
  $('followCursor').disabled=!settings.motion||(!pet.builtin&&pet.spriteVersionNumber<2);
  $('gaze-description').hidden=pet.builtin||pet.spriteVersionNumber>=2;
  $('gaze-description').textContent='Not supported by this pet';
  const key=JSON.stringify(pets.map(p=>[p.id,p.displayName]));
  if(key!==collectionKey){
    collectionKey=key;cards.forEach(c=>c.sprite.stop());cards=[];$('pet-list').replaceChildren();
    for(const p of pets){
      const button=document.createElement('button');button.className='pet-card';button.dataset.petId=p.id;button.setAttribute('aria-label',`Choose ${p.displayName}`);
      const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');
      const name=document.createElement('span');name.className='pet-name';name.textContent=p.displayName;
      const tick=document.createElement('span');tick.className='selected-tick';tick.textContent='✓';tick.setAttribute('aria-hidden','true');
      button.append(canvas,name,tick);
      button.addEventListener('click',()=>update({petId:p.id,visible:true}));
      if(!p.builtin){
        button.title=`${p.displayName} · Right-click to remove`;
        button.addEventListener('contextmenu',event=>{event.preventDefault();run(()=>api.removePet(p.id));});
        button.addEventListener('keydown',event=>{if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();run(()=>api.removePet(p.id));}});
      }
      const sprite=new PetSprite(canvas);sprite.motion=false;sprite.setPet(p).catch(()=>{name.textContent='Unreadable image';});cards.push({button,sprite,tick});$('pet-list').append(button);
    }
    const add=document.createElement('button');add.className='pet-card add-card';add.setAttribute('aria-label','Import a pet folder');
    const plus=document.createElement('span');plus.textContent='+';const label=document.createElement('span');label.className='pet-name';label.textContent='Import folder';add.append(plus,label);add.onclick=()=>importPets('folder');$('pet-list').append(add);
  }
  for(const card of cards){const selected=card.button.dataset.petId===settings.petId;card.button.classList.toggle('selected',selected);card.button.setAttribute('aria-pressed',String(selected));card.tick.hidden=!selected;}
}
function importMessage(results){
  if(!results?.length)return;
  const failures=results.filter(r=>r.error);const added=results.filter(r=>r.pet&&!r.duplicate).length;const duplicates=results.filter(r=>r.duplicate).length;
  if(failures.length)toast(`${added?`${added} added. `:''}${failures[0].source}: ${failures[0].error}`,true);
  else if(added)toast(`Imported ${added} ${added===1?'pet':'pets'}.`);
  else if(duplicates)toast('Already imported.');
}
async function importPets(kind){if(busy)return;busy=true;try{importMessage(await run(()=>api.importPet(kind)));}finally{busy=false;}}
$('import-file').onclick=()=>importPets('file');
$('discover').onclick=async()=>{
  if(busy)return;busy=true;$('discover').disabled=true;
  try{const result=await run(()=>api.discoverPets());if(result){if(!result.found)toast('No custom Codex pets found.');else importMessage(result.results);}}
  finally{busy=false;$('discover').disabled=false;}
};
$('play').onclick=playAnimation;$('hero-pet').onclick=playAnimation;
$('hero-pet').addEventListener('mousemove',event=>{if(state?.settings.followCursor){const rect=$('hero-pet').getBoundingClientRect();hero.gaze={x:(event.clientX-rect.x-rect.width/2)*3,y:(event.clientY-rect.y-rect.height/2)*3};}});
$('hero-pet').addEventListener('mouseleave',()=>hero.gaze=null);
for(const key of ['alwaysOnTop','motion','randomAnimations','followCursor','launchAtLogin','visible'])$(key).onchange=async()=>{const result=await update({[key]:$(key).checked});if(!result&&state)render(state);};
$('size').addEventListener('input',()=>{const size=Number($('size').value);$('size-description').textContent=`${size} px`;});
$('size').addEventListener('change',()=>update({size:Number($('size').value)}));
$('home').onclick=async()=>{if(await run(async()=>{await api.home();return true;}))toast('Position reset.');};
$('github').onclick=event=>{event.preventDefault();run(()=>api.openRepository());};
$('done').onclick=()=>run(()=>api.closeSettings());
let depth=0;
window.addEventListener('dragenter',event=>{event.preventDefault();if(event.dataTransfer.types.includes('Files')){depth++;$('drop-overlay').hidden=false;}});
window.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';});
window.addEventListener('dragleave',event=>{event.preventDefault();if(--depth<=0){depth=0;$('drop-overlay').hidden=true;}});
window.addEventListener('drop',async event=>{event.preventDefault();depth=0;$('drop-overlay').hidden=true;if(busy)return;busy=true;try{importMessage(await run(()=>api.importDropped(event.dataTransfer.files)));}finally{busy=false;}});
api.onState(render);
run(async()=>render(await api.getState()));
