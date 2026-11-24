(function(scope){
class NotePractice {
 constructor(events){this.groups=[...new Set(events.map(e=>e.t))].sort((a,b)=>a-b).map(t=>({t,notes:[...new Set(events.filter(e=>e.t===t).map(e=>e.n))]}));this.stop()}
 stop(){this.active=false;this.collected=new Set()}
 start(){this.index=0;this.collected=new Set();this.active=true;return this.current}
 get current(){return this.groups[this.index]}
 attack(note){if(!this.active)return 'inactive';if(!this.current.notes.includes(note))return 'wrong';this.collected.add(note);if(this.current.notes.some(n=>!this.collected.has(n)))return 'partial';this.index++;this.collected.clear();if(this.index===this.groups.length){this.active=false;return 'finished'}return 'advanced'}
}
if(typeof module!=='undefined')module.exports=NotePractice;else scope.NotePractice=NotePractice;
})(typeof window==='undefined'?{}:window);
